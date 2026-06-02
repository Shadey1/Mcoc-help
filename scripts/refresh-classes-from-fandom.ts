/**
 * Refresh champion class assignments + discover new champions from the Marvel
 * Contest of Champions Fandom wiki via its MediaWiki API.
 *
 * Two passes per run:
 *
 *   A. Class refresh — for each champion already in seed.json, fetch the
 *      Fandom page wikitext, parse the {{ChampionInfoBox}} template's |class=
 *      field, propose a correction if it differs from the committed value.
 *
 *   B. Discovery — query the Recent Changes feed for namespace-0 pages
 *      created in the last DISCOVERY_WINDOW_DAYS (35 by default). Diff the
 *      titles against seed ids, and for each unknown page, propose a stub
 *      entry IF the page has a ChampionInfoBox with an extractable class.
 *      Stubs ship with `sevenStarReleased: false` so the engine filters them
 *      out via loadActiveChampions() until BHR is filled in. Skipped when
 *      --only narrows the run. Override the window with `DISCOVERY_WINDOW_DAYS`
 *      env var (e.g. =180 for a backfill sweep).
 *
 * Why both in one script: a single monthly cron, a single PR, a single set of
 * API helpers. The discovery pass is cheap (~1 category list + ~2 calls per
 * unknown title) and runs after the class refresh.
 *
 * Polite: 1s between API calls. Identifying User-Agent.
 * Idempotent: rerunnable; --only narrows to specific champions for quick fixes
 *   AND skips discovery (it's a full-category sweep, not per-champion).
 *
 * Usage:
 *   pnpm refresh-classes                       # dry-run — writes corrections + additions to JSON
 *   pnpm refresh-classes -- --only "Maestro,Bastion"   # class-only mode, no discovery
 *   pnpm refresh-classes -- --apply            # apply previously-saved corrections + additions
 *   pnpm refresh-classes -- --refresh-apply    # one-shot: fetch + immediately apply
 *
 * Output:
 *   scripts/class-corrections.json — { corrections, additions, issues }
 *   data/champions/seed.json.bak  — backup before --apply (on every apply)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

// ─── Config ─────────────────────────────────────────────────────────────

const SEED_PATH = 'data/champions/seed.json';
const CORRECTIONS_PATH = 'scripts/class-corrections.json';
const OVERRIDES_PATH = 'data/champions/class-overrides.json';
const SEED_BACKUP_PATH = 'data/champions/seed.json.bak';
const API_ENDPOINT = 'https://marvel-contestofchampions.fandom.com/api.php';
const USER_AGENT =
  'mcoc.help class refresher (free MCOC tool; contact via mcoc.help)';
const RATE_LIMIT_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;
/** How far back to look for newly-created Fandom champion pages, in days.
 *  Monthly cron + 5-day buffer catches the previous month's releases even if
 *  a run was missed. Override via DISCOVERY_WINDOW_DAYS env var for backfill.
 *
 *  Why time-windowed instead of category-diff: Fandom's `Category:Champion`
 *  contains every champion ever released at any star rarity (~408 pages),
 *  while seed.json only covers 7-star champions (~254). Naive diff surfaces
 *  ~150 legacy 1-/3-/5-star variants as "additions". A time-window over
 *  page-creation events selects for genuinely-new champions instead. */
const DISCOVERY_WINDOW_DAYS = Number(process.env.DISCOVERY_WINDOW_DAYS ?? 35);
/** Portrait thumbnail width — matches scrape-fandom-portraits.ts. */
const THUMB_WIDTH = 200;

const VALID_CLASSES = ['Mutant', 'Skill', 'Science', 'Mystic', 'Cosmic', 'Tech'] as const;
type ChampionClass = (typeof VALID_CLASSES)[number];

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY_ONLY = args.includes('--apply');
const REFRESH_APPLY = args.includes('--refresh-apply');
const ONLY_ARG = args.find((a) => a.startsWith('--only'));
const ONLY_NAMES: Set<string> | null = ONLY_ARG
  ? new Set(
      (ONLY_ARG.split('=')[1] ?? args[args.indexOf(ONLY_ARG) + 1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
  : null;

// ─── Types ──────────────────────────────────────────────────────────────

type Champion = {
  id: string;
  name: string;
  class: string;
  ascendable: boolean;
  [k: string]: unknown;
};

type Correction = {
  id: string;
  name: string;
  currentClass: string;
  proposedClass: ChampionClass;
  sourceTitle: string;
};

/** A stub champion discovered on Fandom but missing from seed.json. Class is
 *  required (we drop candidates where we can't extract one); BHR is a sentinel
 *  pending manual backfill. `sevenStarReleased: false` keeps the entry out of
 *  engine inputs until the BHR is filled in. */
type Addition = {
  id: string;
  name: string;
  proposedClass: ChampionClass;
  sourceTitle: string;
  portraitUrl: string | null;
};

type RefreshResult =
  | { kind: 'unchanged'; class: ChampionClass; sourceTitle: string }
  | { kind: 'correction'; from: string; to: ChampionClass; sourceTitle: string }
  | { kind: 'no-page' }
  | { kind: 'no-infobox-class'; sourceTitle: string }
  | { kind: 'unrecognised-class'; raw: string; sourceTitle: string }
  | { kind: 'api-error'; reason: string };

// ─── API helpers (mirrors scrape-fandom-portraits.ts) ───────────────────

async function apiFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      throw new Error(`API returned non-JSON (got ${contentType}). Cloudflare challenge?`);
    }
    return res.json();
  } catch (e) {
    // Surface aborts as a clearer error so the caller knows it was a timeout
    if ((e as Error).name === 'AbortError') {
      throw new Error(`API call timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a champion name to a canonical Fandom page title, or null. */
async function resolvePageTitle(name: string): Promise<string | null> {
  // Try the name exactly first
  if (await pageExists(name)) return name;
  await sleep(RATE_LIMIT_MS);

  // Hyphen-normalised (Spider Man → Spider-Man) — matches the portrait
  // scraper's heuristic, since Fandom is hyphen-consistent and MCOCHUB
  // sometimes drops them
  const hyphenated = name
    .replace(/\bSpider Man\b/gi, 'Spider-Man')
    .replace(/\bSpider man\b/g, 'Spider-Man');
  if (hyphenated !== name) {
    if (await pageExists(hyphenated)) return hyphenated;
    await sleep(RATE_LIMIT_MS);
  }

  // Search fallback
  try {
    const data = (await apiFetch({
      action: 'opensearch',
      search: name,
      limit: '3',
      namespace: '0',
    })) as [string, string[], string[], string[]];
    const titles = data[1] ?? [];
    return titles[0] ?? null;
  } catch {
    return null;
  }
}

async function pageExists(title: string): Promise<boolean> {
  type Resp = {
    query?: { pages?: Array<{ missing?: boolean; title?: string }> };
  };
  try {
    const data = (await apiFetch({
      action: 'query',
      titles: title,
      prop: 'info',
    })) as Resp;
    const page = data.query?.pages?.[0];
    return !!page && !page.missing;
  } catch {
    return false;
  }
}

/** Fetch the latest wikitext for a page title. */
async function fetchWikitext(title: string): Promise<string | null> {
  type Resp = {
    query?: {
      pages?: Array<{
        missing?: boolean;
        revisions?: Array<{ slots?: { main?: { content?: string } } }>;
      }>;
    };
  };
  const data = (await apiFetch({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    rvlimit: '1',
  })) as Resp;
  const page = data.query?.pages?.[0];
  if (!page || page.missing) return null;
  return page.revisions?.[0]?.slots?.main?.content ?? null;
}

/** Page-image thumbnail for a title, or null. Mirrors scrape-fandom-portraits.ts
 *  but kept local to avoid a script-to-script dependency. */
async function getPageImage(title: string): Promise<string | null> {
  type Resp = {
    query?: {
      pages?: Array<{
        missing?: boolean;
        thumbnail?: { source: string };
        original?: { source: string };
      }>;
    };
  };
  try {
    const data = (await apiFetch({
      action: 'query',
      titles: title,
      prop: 'pageimages',
      piprop: 'thumbnail|original',
      pithumbsize: String(THUMB_WIDTH),
    })) as Resp;
    const page = data.query?.pages?.[0];
    if (!page || page.missing) return null;
    return page.thumbnail?.source ?? page.original?.source ?? null;
  } catch {
    return null;
  }
}

/** Query the Recent Changes feed for newly-created namespace-0 pages within
 *  the last `windowDays`. Returns titles ordered newest-first. */
async function fetchRecentlyCreatedPages(windowDays: number): Promise<string[]> {
  type Resp = {
    query?: { recentchanges?: Array<{ title: string; timestamp: string }> };
  };
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffISO = cutoff.toISOString();
  const data = (await apiFetch({
    action: 'query',
    list: 'recentchanges',
    rcnamespace: '0',
    rctype: 'new',
    rclimit: '500',
    rcprop: 'title|timestamp',
    rcdir: 'older',
  })) as Resp;
  return (data.query?.recentchanges ?? [])
    .filter((p) => p.timestamp >= cutoffISO)
    .map((p) => p.title);
}

/** Canonicalise a Fandom page title to a seed.json-style id.
 *   "Spider-Man (Stark Enhanced)" → "spider-man-stark-enhanced" */
function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Wikitext infobox parsing ───────────────────────────────────────────

/**
 * Find the ChampionInfoBox or Champion template invocation and return its body.
 *
 * Uses a balanced-brace scan rather than a regex, because regex-based extraction
 * breaks when the infobox contains a nested template (e.g. `|class = {{Class|Cosmic}}`)
 * — the non-greedy `}}` matcher stops at the inner template's close, truncating the
 * body. The balanced scan correctly skips over inner `{{...}}` blocks.
 */
function extractInfoboxBody(wikitext: string): string | null {
  const templateNames = ['ChampionInfoBox', 'Champion', 'Infobox Champion', 'ChampionInfobox'];
  for (const tpl of templateNames) {
    const re = new RegExp(`\\{\\{\\s*${tpl.replace(/ /g, '[ _]')}\\b`, 'i');
    const m = wikitext.match(re);
    if (!m || m.index === undefined) continue;
    const startIdx = m.index + m[0].length;
    let depth = 1;
    let i = startIdx;
    while (i < wikitext.length - 1) {
      const two = wikitext.slice(i, i + 2);
      if (two === '{{') {
        depth++;
        i += 2;
      } else if (two === '}}') {
        depth--;
        if (depth === 0) return wikitext.slice(startIdx, i);
        i += 2;
      } else {
        i++;
      }
    }
  }
  return null;
}

/** Extract the |class= field value from an infobox body. */
function extractRawClass(infoboxBody: string): string | null {
  // Match |class = SomeValue stopping at end of line
  const m = infoboxBody.match(/\|\s*class\s*=\s*([^\n]*)/i);
  if (!m || !m[1]) return null;
  let value = m[1].trim();
  // ORDER MATTERS:
  //   1. Strip template wrappers first ({{Class|Science}} → Science) while the
  //      closing }} is still present.
  //   2. Then strip a trailing }} that belonged to the *enclosing* infobox
  //      (only relevant when class is the last field on its line).
  const tplMatch = value.match(/\{\{[^|]+\|\s*([A-Za-z]+)\s*\}\}/);
  if (tplMatch && tplMatch[1]) {
    value = tplMatch[1];
  } else {
    value = value.replace(/\}\}\s*$/, '').trim();
  }
  // Strip wikilink syntax [[Science]] or [[Science|something]]
  const linkMatch = value.match(/\[\[([^\]|]+)/);
  if (linkMatch && linkMatch[1]) value = linkMatch[1];
  return value.trim() || null;
}

/** Normalise a raw class string to one of the six canonical values, or null. */
function normaliseClass(raw: string): ChampionClass | null {
  const lower = raw.toLowerCase().trim();
  for (const c of VALID_CLASSES) {
    if (lower === c.toLowerCase()) return c;
  }
  return null;
}

// ─── Per-champion refresh ───────────────────────────────────────────────

async function refreshChampion(
  champion: Champion,
  overrides: Map<string, ChampionClass>,
): Promise<RefreshResult> {
  // Manual override takes precedence over Fandom. Used for champions where
  // Fandom data is unreliable (disambiguation pages, recombined-champion
  // infoboxes, missing class fields). See data/champions/class-overrides.json.
  const override = overrides.get(champion.id);
  if (override) {
    if (override === champion.class) {
      return { kind: 'unchanged', class: override, sourceTitle: 'manual-override' };
    }
    return {
      kind: 'correction',
      from: champion.class,
      to: override,
      sourceTitle: 'manual-override',
    };
  }

  let title: string | null;
  try {
    title = await resolvePageTitle(champion.name);
  } catch (e) {
    return { kind: 'api-error', reason: `Title resolution failed: ${(e as Error).message}` };
  }
  if (!title) return { kind: 'no-page' };
  await sleep(RATE_LIMIT_MS);

  let wikitext: string | null;
  try {
    wikitext = await fetchWikitext(title);
  } catch (e) {
    return { kind: 'api-error', reason: `Wikitext fetch failed: ${(e as Error).message}` };
  }
  if (!wikitext) return { kind: 'no-page' };

  const infoboxBody = extractInfoboxBody(wikitext);
  if (!infoboxBody) return { kind: 'no-infobox-class', sourceTitle: title };

  const rawClass = extractRawClass(infoboxBody);
  if (!rawClass) return { kind: 'no-infobox-class', sourceTitle: title };

  const normalised = normaliseClass(rawClass);
  if (!normalised) return { kind: 'unrecognised-class', raw: rawClass, sourceTitle: title };

  if (normalised === champion.class) {
    return { kind: 'unchanged', class: normalised, sourceTitle: title };
  }
  return { kind: 'correction', from: champion.class, to: normalised, sourceTitle: title };
}

// ─── Discovery: find Fandom champions missing from seed.json ────────────

/**
 * Enumerate Fandom's champion category, diff against seed.json, return a stub
 * Addition for each Fandom page whose id isn't in the seed. Drops candidates
 * we can't extract a class for — better to surface the issue than to invent
 * a default.
 */
async function discoverNewChampions(
  seed: { champions: Champion[] },
): Promise<{ additions: Addition[]; skipped: Array<{ title: string; reason: string }> }> {
  const existingIds = new Set(seed.champions.map((c) => c.id));
  const existingNames = new Set(seed.champions.map((c) => c.name.toLowerCase().trim()));

  console.log(`Querying Fandom for pages created in the last ${DISCOVERY_WINDOW_DAYS} days…`);
  let titles: string[];
  try {
    titles = await fetchRecentlyCreatedPages(DISCOVERY_WINDOW_DAYS);
  } catch (e) {
    console.warn(
      `  ⚠ Could not query recent changes: ${(e as Error).message}. Discovery skipped.`,
    );
    return { additions: [], skipped: [] };
  }
  console.log(`  Found ${titles.length} new page${titles.length === 1 ? '' : 's'} in window.`);

  // Drop pages that obviously aren't champion entries: anything with a
  // namespace prefix, lists, file pages, etc. The ChampionInfoBox extraction
  // below provides a second hard filter — non-champion pages don't have one.
  const candidates = titles.filter((t) => {
    if (t.includes(':')) return false;
    if (/^(List|Category|Champions|File)\b/i.test(t)) return false;
    return true;
  });

  // Diff against existing seed entries by id AND by case-insensitive name —
  // belt-and-braces against id-vs-name drift (existing seed names already in
  // play under a different canonicalisation).
  const unknown = candidates.filter((t) => {
    return !existingIds.has(idFromName(t)) && !existingNames.has(t.toLowerCase().trim());
  });

  console.log(
    `  ${unknown.length} candidate addition${unknown.length === 1 ? '' : 's'} not in seed.json.`,
  );

  const additions: Addition[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];

  for (let i = 0; i < unknown.length; i++) {
    const title = unknown[i]!;
    const progress = `[${i + 1}/${unknown.length}]`;

    let proposedClass: ChampionClass | null = null;
    let portraitUrl: string | null = null;

    try {
      const wikitext = await fetchWikitext(title);
      if (wikitext) {
        const body = extractInfoboxBody(wikitext);
        if (body) {
          const raw = extractRawClass(body);
          if (raw) proposedClass = normaliseClass(raw);
        }
      }
    } catch (e) {
      skipped.push({ title, reason: `class fetch failed: ${(e as Error).message}` });
      console.log(`${progress} ${title}: skip (class fetch error)`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }
    await sleep(RATE_LIMIT_MS);

    if (!proposedClass) {
      skipped.push({ title, reason: 'no class extractable from infobox' });
      console.log(`${progress} ${title}: skip (no class in infobox)`);
      continue;
    }

    portraitUrl = await getPageImage(title);
    await sleep(RATE_LIMIT_MS);

    additions.push({
      id: idFromName(title),
      name: title,
      proposedClass,
      sourceTitle: title,
      portraitUrl,
    });
    console.log(
      `${progress} ${title}: +ADD (${proposedClass}${portraitUrl ? ', portrait' : ', no portrait'})`,
    );
  }

  return { additions, skipped };
}

// ─── Two-mode main ──────────────────────────────────────────────────────

function readSeed(): { champions: Champion[] } {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { champions: Champion[] };
}

function writeSeed(seed: { champions: Champion[] }) {
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
}

/**
 * Load manual class overrides. Returns an empty map if the file is missing
 * or malformed — overrides are an optional safety net, never required.
 */
function loadOverrides(): Map<string, ChampionClass> {
  if (!existsSync(OVERRIDES_PATH)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) as {
      overrides?: Record<string, string>;
    };
    const out = new Map<string, ChampionClass>();
    for (const [id, klass] of Object.entries(raw.overrides ?? {})) {
      if ((VALID_CLASSES as readonly string[]).includes(klass)) {
        out.set(id, klass as ChampionClass);
      } else {
        console.warn(
          `  ⚠ class-overrides.json: "${klass}" for ${id} is not a valid class — ignoring`,
        );
      }
    }
    return out;
  } catch (e) {
    console.warn(`  ⚠ Could not parse ${OVERRIDES_PATH}: ${(e as Error).message}`);
    return new Map();
  }
}

/** Apply a saved corrections file to seed.json (backs up first). */
function applyCorrections() {
  if (!existsSync(CORRECTIONS_PATH)) {
    console.error(`No corrections file at ${CORRECTIONS_PATH}. Run a dry-run first.`);
    process.exit(1);
  }
  const corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')) as {
    corrections: Correction[];
    additions?: Addition[];
  };
  const additions = corrections.additions ?? [];
  if (corrections.corrections.length === 0 && additions.length === 0) {
    console.log('No corrections or additions to apply. seed.json untouched.');
    return;
  }

  console.log(`Backing up seed.json → ${SEED_BACKUP_PATH}`);
  copyFileSync(SEED_PATH, SEED_BACKUP_PATH);

  const seed = readSeed();
  const byId = new Map(seed.champions.map((c) => [c.id, c]));
  let applied = 0;
  let skipped = 0;
  for (const corr of corrections.corrections) {
    const champion = byId.get(corr.id);
    if (!champion) {
      console.warn(`  ⚠ ${corr.name} (id=${corr.id}): not in seed, skipping`);
      skipped++;
      continue;
    }
    if (champion.class === corr.proposedClass) {
      // Already correct (perhaps applied earlier) — silently skip
      continue;
    }
    console.log(
      `  ${corr.name}: ${champion.class} → ${corr.proposedClass} (source: ${corr.sourceTitle})`,
    );
    champion.class = corr.proposedClass;
    applied++;
  }

  // Append stub entries for newly-discovered champions. sevenStarReleased:false
  // keeps them out of engine math; the bhrSource marker flags them for manual
  // BHR backfill. Skip any that have already landed in seed (re-apply safety).
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  let addSkipped = 0;
  for (const add of additions) {
    if (byId.has(add.id)) {
      console.warn(`  ⚠ ${add.name} (id=${add.id}): already in seed, skipping addition`);
      addSkipped++;
      continue;
    }
    const stub = {
      id: add.id,
      name: add.name,
      class: add.proposedClass,
      ascendable: false,
      prestige: { rank5: { '0': 1, '200': 1 } },
      sigCurve: null,
      tags: [],
      _meta: {
        bhrSource: `PENDING — auto-added stub from Fandom on ${today}; backfill BHR + ascendable before flipping sevenStarReleased`,
      },
      portraitUrl: add.portraitUrl,
      sevenStarReleased: false,
    };
    seed.champions.push(stub as unknown as Champion);
    byId.set(stub.id, stub as unknown as Champion);
    console.log(`  +ADD ${add.name} (${add.proposedClass}) — sevenStarReleased=false, BHR PENDING`);
    added++;
  }
  // Keep seed.json sorted by name (default ASCII compare — matches the
  // canonical order of the hand-built seed) so new entries land in the
  // right spot without reshuffling everything else.
  if (added > 0) {
    seed.champions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  writeSeed(seed);
  console.log(
    `\nApplied ${applied} correction${applied === 1 ? '' : 's'}` +
      (skipped > 0 ? ` (${skipped} skipped — see warnings above)` : '') +
      `, ${added} addition${added === 1 ? '' : 's'}` +
      (addSkipped > 0 ? ` (${addSkipped} skipped — already in seed)` : '') +
      `. seed.json updated.`,
  );
}

async function dryRun() {
  const seed = readSeed();
  const overrides = loadOverrides();
  let targets = seed.champions;
  if (ONLY_NAMES) {
    targets = targets.filter((c) => ONLY_NAMES.has(c.name));
    console.log(`Filtered to ${targets.length} champion(s) matching --only.`);
  } else {
    console.log(`Refreshing classes for ${targets.length} champions from Fandom wiki…`);
  }
  if (overrides.size > 0) {
    console.log(
      `Loaded ${overrides.size} manual override${overrides.size === 1 ? '' : 's'} from ${OVERRIDES_PATH}`,
    );
  }
  console.log(`Source: ${API_ENDPOINT}`);
  console.log(`Rate limit: ${RATE_LIMIT_MS}ms between calls\n`);

  // Discovery pass — find Fandom champions missing from seed.json. Skipped
  // entirely when --only filters are in play (it's a full-category sweep,
  // not a per-champion check).
  let additions: Addition[] = [];
  let discoverySkipped: Array<{ title: string; reason: string }> = [];
  if (!ONLY_NAMES) {
    const discovered = await discoverNewChampions(seed);
    additions = discovered.additions;
    discoverySkipped = discovered.skipped;
    console.log('');
  }

  const corrections: Correction[] = [];
  const issues: Array<{ name: string; result: RefreshResult }> = [];
  let unchanged = 0;
  let apiErrors = 0;

  for (let i = 0; i < targets.length; i++) {
    const champion = targets[i]!;
    const progress = `[${i + 1}/${targets.length}]`;
    try {
      const result = await refreshChampion(champion, overrides);
      switch (result.kind) {
        case 'unchanged': {
          unchanged++;
          // Heartbeat: every 10th champion + via-override always logs. Silent
          // stretches confused users into thinking the script had hung.
          const viaOverride = result.sourceTitle === 'manual-override';
          if (viaOverride || (i + 1) % 10 === 0) {
            const note = viaOverride ? ' (override)' : '';
            console.log(`${progress} ${champion.name}: unchanged${note}`);
          }
          break;
        }
        case 'correction':
          corrections.push({
            id: champion.id,
            name: champion.name,
            currentClass: result.from,
            proposedClass: result.to,
            sourceTitle: result.sourceTitle,
          });
          console.log(
            `${progress} ${champion.name}: ${result.from} → ${result.to}  (${result.sourceTitle})`,
          );
          break;
        case 'no-page':
          issues.push({ name: champion.name, result });
          console.log(`${progress} ${champion.name}: no Fandom page found`);
          break;
        case 'no-infobox-class':
          issues.push({ name: champion.name, result });
          console.log(`${progress} ${champion.name}: page exists but no |class= in infobox`);
          break;
        case 'unrecognised-class':
          issues.push({ name: champion.name, result });
          console.log(
            `${progress} ${champion.name}: raw class "${result.raw}" not one of ${VALID_CLASSES.join('/')}`,
          );
          break;
        case 'api-error':
          issues.push({ name: champion.name, result });
          apiErrors++;
          console.log(`${progress} ${champion.name}: API error — ${result.reason}`);
          // If errors are piling up, the API may be rate-limiting us. Back off.
          if (apiErrors >= 5) {
            console.error('\n5 consecutive-ish API errors. Backing off, please retry later.');
            break;
          }
          break;
      }
    } catch (e) {
      console.log(`${progress} ${champion.name}: unexpected error — ${(e as Error).message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Persist corrections + additions + issues. discoverySkipped is folded into
  // issues so the workflow PR body has a single bucket of things to eyeball.
  const allIssues = [
    ...issues,
    ...discoverySkipped.map((s) => ({
      name: s.title,
      result: { kind: 'discovery-skipped' as const, reason: s.reason },
    })),
  ];
  writeFileSync(
    CORRECTIONS_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), corrections, additions, issues: allIssues },
      null,
      2,
    ) + '\n',
  );

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Unchanged:     ${unchanged}`);
  console.log(`Corrections:   ${corrections.length}`);
  console.log(`Additions:     ${additions.length}`);
  console.log(`Issues:        ${allIssues.length}`);
  console.log(`Total scanned: ${targets.length}`);
  console.log('');
  console.log(`Corrections written to: ${CORRECTIONS_PATH}`);
  console.log('Review the file, remove any false positives, then:');
  console.log('  pnpm refresh-classes -- --apply');
  console.log('to commit changes to seed.json.');
}

async function main() {
  if (APPLY_ONLY) {
    applyCorrections();
    return;
  }
  if (REFRESH_APPLY) {
    await dryRun();
    console.log('\n--refresh-apply set; applying immediately.\n');
    applyCorrections();
    return;
  }
  await dryRun();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
