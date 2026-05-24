/**
 * Refresh champion class assignments from the Marvel Contest of Champions
 * Fandom wiki via its MediaWiki API.
 *
 * Why this exists: `data/champions/seed.json` was hand-built from architecture
 * doc dumps. Manual entry produced systematic mis-classifications (notably ~12
 * Mutants over-counted, ~6 Cosmics under-counted as of v0.15.0). Hand
 * proofreading 254 entries is unreliable. The Fandom wiki has authoritative,
 * community-maintained class data in machine-readable infobox templates,
 * licensed CC-BY-SA — exactly what we should be using.
 *
 * Strategy:
 *   1. For each champion in seed.json, resolve to a canonical Fandom page
 *      title (exact name → hyphen-normalised → opensearch fallback). Reuses
 *      the resolution ladder from scrape-fandom-portraits.ts.
 *   2. Fetch the page wikitext via action=query + prop=revisions.
 *   3. Parse the {{ChampionInfoBox}} template, extract the |class= field.
 *      Normalise common variants ({{Class|Science}}, "science", trailing
 *      whitespace, etc.) to one of the six canonical classes.
 *   4. Diff against seed.json. Write corrections to scripts/class-corrections.json
 *      for human review.
 *   5. With --apply, read scripts/class-corrections.json and rewrite seed.json
 *      (backup at seed.json.bak).
 *
 * Polite: 1s between API calls. Identifying User-Agent.
 * Idempotent: rerunnable; --only narrows to specific champions for quick fixes.
 *
 * Usage:
 *   pnpm refresh-classes                       # dry-run — writes corrections JSON
 *   pnpm refresh-classes -- --only "Maestro,Bastion"
 *   pnpm refresh-classes -- --apply            # apply previously-saved corrections
 *   pnpm refresh-classes -- --refresh-apply    # one-shot: fetch + immediately apply
 *
 * Output:
 *   scripts/class-corrections.json — list of {id, name, currentClass, proposedClass, sourceTitle}
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
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new Error(`API returned non-JSON (got ${contentType}). Cloudflare challenge?`);
  }
  return res.json();
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
  };
  if (corrections.corrections.length === 0) {
    console.log('No corrections to apply. seed.json untouched.');
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
  writeSeed(seed);
  console.log(
    `\nApplied ${applied} correction${applied === 1 ? '' : 's'}` +
      (skipped > 0 ? ` (${skipped} skipped — see warnings above)` : '') +
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
        case 'unchanged':
          unchanged++;
          break;
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

  // Persist corrections + issues
  writeFileSync(
    CORRECTIONS_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), corrections, issues }, null, 2) +
      '\n',
  );

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Unchanged:     ${unchanged}`);
  console.log(`Corrections:   ${corrections.length}`);
  console.log(`Issues:        ${issues.length}`);
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
