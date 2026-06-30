/**
 * Fetch champion ability data from MCOCHUB and write to data/champions/abilities.json.
 *
 * MCOCHUB renders every champion's page server-side at /champions/{slug}.
 * The page exposes two layers we capture:
 *
 *   1. `pills` — the sidebar timeline pill sections (Abilities, Immunities,
 *      Tags). These are flat lists, queryable from roster-table filters and
 *      the war planner. Innate vs synergy-granted is distinguished by CSS
 *      class (bg-emerald-500/15 / bg-slate-700/60 vs bg-cyan-500/15 with an
 *      Alpine.js tooltip).
 *
 *   2. `kit` — the Signature Ability section + the Abilities <details>
 *      cards (e.g. "LORD OF DARKNESS — ALWAYS ACTIVE"). Rich text, only
 *      rendered on the champion detail page.
 *
 * Strategy:
 *   - Iterate every released seed champion (sevenStarReleased only).
 *   - Try seed.id as the MCOCHUB slug first; fall back to a normalisation
 *     ladder for the long tail.
 *   - Rate-limit politely (1 req/sec).
 *   - Cache to .cache/mcochub-pages/ so re-runs don't re-fetch unchanged
 *     champions.
 *   - Dependency-free regex parse — same approach as
 *     refresh-bhr-from-mcochub.ts. node-html-parser would be cleaner but
 *     adds a dep for one script.
 *   - Write data/champions/abilities.json + scripts/abilities-unresolved.json
 *     (the per-champion list that needs slug remapping).
 *
 * Usage:
 *   pnpm refresh-abilities                    # full run
 *   pnpm refresh-abilities -- --limit 10      # first 10 only (smoke test)
 *   pnpm refresh-abilities -- --ids knull,storm  # specific champs
 *   pnpm refresh-abilities -- --no-cache      # bypass cache (force re-fetch)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SEED_PATH = 'data/champions/seed.json';
const OUTPUT_PATH = 'data/champions/abilities.json';
const UNRESOLVED_PATH = 'scripts/abilities-unresolved.json';
const CACHE_DIR = '.cache/mcochub-pages';
const INDEX_CACHE_PATH = `${CACHE_DIR}/_index.html`;
const BASE_URL = 'https://mcochub.insaneskull.com/champions';
const INDEX_URL = 'https://mcochub.insaneskull.com/champions';
const USER_AGENT =
  'mcoc.help abilities refresher (free MCOC tool; contact via mcoc.help)';
const FETCH_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MS = 1_000;

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}
const LIMIT = flagValue('--limit') ? Number(flagValue('--limit')) : undefined;
const ONLY_IDS = flagValue('--ids')?.split(',').map((s) => s.trim()) ?? null;
const NO_CACHE = args.includes('--no-cache');

// ─── Types ──────────────────────────────────────────────────────────────

type SynergyPill = {
  partners: string[]; // MCOCHUB partner slugs (lowercase, no spaces)
  note: string; // the conditional/effect description
};

type Pill = {
  name: string;
  synergy?: SynergyPill;
};

type KitCard = {
  title: string;
  trigger: string;
  lines: string[];
};

type ChampionAbilities = {
  source: { slug: string; url: string };
  pills: {
    abilities: Pill[];
    immunities: Pill[];
    tags: string[];
  };
  kit: {
    signature: KitCard | null;
    cards: KitCard[];
  };
};

type SeedChampion = {
  id: string;
  name: string;
  sevenStarReleased?: boolean;
};

// ─── Slug reconciliation ─────────────────────────────────────────────────

/**
 * Canonicalise a display name for fuzzy lookups: lowercase, strip diacritics,
 * curly quotes, parens, dashes — everything except [a-z0-9]. So "Æ gon",
 * "Captain America (Infinity War)" and "M'Baku" become "aegon",
 * "captainamericainfinitywar" and "mbaku" respectively.
 */
function canonicaliseName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Fetch MCOCHUB's champions index, find the Alpine.js filterSelect labels
 * map (`{"slug": "Display Name", …}`), and return a name → slug lookup.
 */
async function loadMcochubIndex(): Promise<Map<string, string>> {
  let html: string;
  if (!NO_CACHE && existsSync(INDEX_CACHE_PATH)) {
    html = readFileSync(INDEX_CACHE_PATH, 'utf8');
  } else {
    const res = await fetch(INDEX_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    if (!res.ok) {
      throw new Error(`Champions index fetch failed: HTTP ${res.status}`);
    }
    html = await res.text();
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(INDEX_CACHE_PATH, html);
  }
  // Find the JSON.parse argument inside the labels: ... position. The value
  // is wrapped in escaped single-quote-as-unicode (") sequences so
  // we look for `JSON.parse('{"slug...` and capture up to the closing `}`.
  const m = /labels:\s*JSON\.parse\('([^']+)'\)/.exec(html);
  if (!m) throw new Error('Could not find labels JSON in MCOCHUB index');
  // The raw attribute is a JS-string-literal-escaped JSON document:
  //  - ", ' etc. were Alpine's way of emitting " and ' that would
  //    otherwise break the surrounding `'…'` JS string
  //  - \\u2019, \\n etc. are real JSON escape sequences that had their
  //    backslash doubled to survive the same JS literal
  // Walk every \\, \uNNNN once. Lone `\\` → `\`, lone `\uNNNN` → codepoint.
  // Sequences like `\\u2019` (already-escaped JSON escape) survive: the `\\`
  // alternative fires first, leaving `’` for JSON.parse to handle.
  const decoded = m[1]!.replace(
    /\\(\\|u([0-9a-f]{4}))/gi,
    (_match, all: string, hex: string | undefined) =>
      all === '\\' ? '\\' : String.fromCodePoint(parseInt(hex!, 16)),
  );
  const parsed = JSON.parse(decoded) as Record<string, string>;
  const byName = new Map<string, string>();
  for (const [slug, name] of Object.entries(parsed)) {
    byName.set(canonicaliseName(name), slug);
  }
  return byName;
}

function slugCandidates(c: SeedChampion, indexByName: Map<string, string>): string[] {
  const out = new Set<string>();
  // Primary: lookup via MCOCHUB's own labels map by display name.
  const fromIndex = indexByName.get(canonicaliseName(c.name));
  if (fromIndex) out.add(fromIndex);
  // Fallbacks for the (rare) case the index doesn't carry a name.
  out.add(c.id);
  out.add(c.id.replace(/-/g, ''));
  out.add(c.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  out.add(
    c.name
      .toLowerCase()
      .replace(/[()]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, ''),
  );
  return Array.from(out).filter(Boolean);
}

// ─── Fetch + cache ───────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cachePath(slug: string): string {
  return join(CACHE_DIR, `${slug}.html`);
}

async function fetchPage(slug: string): Promise<string | null> {
  const url = `${BASE_URL}/${slug}`;
  const cached = cachePath(slug);
  if (!NO_CACHE && existsSync(cached)) {
    return readFileSync(cached, 'utf8');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: ctl.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, html);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Parsing ─────────────────────────────────────────────────────────────

/** Strip every HTML tag from a fragment, normalise whitespace, decode the
 *  small set of entities MCOCHUB emits (&amp; &nbsp; &#39; etc). */
function plainText(html: string): string {
  return (
    html
      .replace(/<[^>]+>/g, '')
      // Numeric entities first (covers &#039;, &#x27;, &#8217; etc).
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec: string) =>
        String.fromCodePoint(parseInt(dec, 10)),
      )
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&rsquo;|&lsquo;|&apos;/g, "'")
      .replace(/&rdquo;|&ldquo;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&hellip;/g, '…')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Find the matching close index for a tag that opens at `openIdx` (which
 * points at the `<` of an opening tag, e.g. `<div ...`). Tracks nesting
 * over `<tag` / `</tag` pairs. Returns the index of the `>` of the
 * matching close tag, or -1 if not found.
 */
function findMatchingClose(html: string, openIdx: number, tag: string): number {
  const openRe = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  openRe.lastIndex = openIdx + 1;
  closeRe.lastIndex = openIdx + 1;
  let depth = 1;
  while (depth > 0) {
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      closeRe.lastIndex = nextOpen.index;
    } else {
      depth--;
      if (depth === 0) return nextClose.index + nextClose[0].length - 1;
      openRe.lastIndex = nextClose.index;
    }
  }
  return -1;
}

/**
 * Locate a sidebar timeline section by its label colour and return the
 * inner HTML of its pill container (`<div class="flex flex-wrap...">`).
 *
 * The page lays each section out as:
 *   <div class="mb-2 ... text-{COLOR}-400">{LABEL}</div>
 *   <div class="flex flex-wrap gap-1.5"> ...pills... </div>
 */
function findPillSection(
  html: string,
  label: string,
  colour: string,
): string | null {
  const labelRe = new RegExp(
    `<div[^>]*text-${colour}-400[^>]*>\\s*${label}\\s*</div>`,
    'i',
  );
  const labelMatch = labelRe.exec(html);
  if (!labelMatch) return null;
  const containerOpen = html.indexOf(
    '<div class="flex flex-wrap',
    labelMatch.index + labelMatch[0].length,
  );
  if (containerOpen === -1) return null;
  const containerClose = findMatchingClose(html, containerOpen, 'div');
  if (containerClose === -1) return null;
  const inner = html.slice(containerOpen, containerClose + 1);
  return inner;
}

/**
 * Parse a pill container's inner HTML into Pill[]. Walks the section
 * sequentially and recognises:
 *   - innate pills: <span class="...bg-emerald-500/15..." | "...bg-slate-700/60..." >NAME</span>
 *   - synergy pills: <span x-data="..." > … <button aria-label="Granted via synergy">NAME<svg... > …
 *     with tooltip text in <span class="block text-gray-100">NOTE</span> and
 *     partner names in <img alt="PARTNER" src="...champs/SLUG.(png|webp)" >
 */
function parsePills(containerHtml: string): Pill[] {
  const pills: Pill[] = [];

  // Walk top-level <span> children. We split deliberately: every direct
  // child of the container starts with a <span (either a plain pill or an
  // Alpine.js synergy wrapper). Use findMatchingClose to handle nesting.
  let i = 0;
  while (i < containerHtml.length) {
    const open = containerHtml.indexOf('<span', i);
    if (open === -1) break;
    const close = findMatchingClose(containerHtml, open, 'span');
    if (close === -1) break;
    const fragment = containerHtml.slice(open, close + 1);
    i = close + 1;

    if (fragment.includes('aria-label="Granted via synergy"')) {
      // Synergy pill. The label text is between the </svg> ... wait — it's
      // actually BEFORE the <svg> inside <button>. Find the button content.
      const buttonMatch = /<button\b[^>]*>([\s\S]*?)<\/button>/i.exec(fragment);
      const buttonContent = buttonMatch ? buttonMatch[1]! : '';
      // The pill name is the text BEFORE the inline <svg>.
      const beforeSvg = buttonContent.split('<svg')[0] ?? '';
      const name = plainText(beforeSvg);
      if (!name) continue;
      // Tooltip note: the LAST <span class="block text-gray-100">…</span>
      // inside the fragment (the structure puts the description below the
      // partner list).
      const noteMatches = [
        ...fragment.matchAll(
          /<span[^>]*class="[^"]*block[^"]*text-gray-100[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        ),
      ];
      const note = noteMatches.length
        ? plainText(noteMatches[noteMatches.length - 1]![1]!)
        : '';
      // Partner slugs from <img src="...champs/SLUG.png|webp" alt="...">
      const partners: string[] = [];
      const partnerRe =
        /<img[^>]*src="[^"]*\/champs\/([^"./]+)\.(?:png|webp|jpg|jpeg)[^"]*"/gi;
      let pm: RegExpExecArray | null;
      while ((pm = partnerRe.exec(fragment)) !== null) {
        partners.push(pm[1]!);
      }
      pills.push({ name, synergy: { partners, note } });
    } else if (
      fragment.startsWith('<span ') &&
      /class="[^"]*(?:bg-emerald-500\/15|bg-slate-700\/60|bg-rose-500\/15|bg-amber-500\/15|bg-cyan-500\/15)[^"]*"/i.test(
        fragment.slice(0, 400),
      )
    ) {
      // Innate pill: simple span containing the name.
      const name = plainText(fragment);
      if (name) pills.push({ name });
    }
    // Otherwise: skip (unrelated nested spans).
  }
  return pills;
}

function parseTags(containerHtml: string): string[] {
  const tags: string[] = [];
  const re =
    /<span[^>]*class="[^"]*text-indigo-200[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(containerHtml)) !== null) {
    const raw = plainText(m[1]!);
    if (!raw) continue;
    tags.push(raw.startsWith('#') ? raw.slice(1) : raw);
  }
  return tags;
}

/**
 * Parse the rich Signature Ability section. Layout:
 *   <h2 ...>Signature Ability (Sig N)</h2>
 *   <div ...>
 *     <div ...>TITLE</div>
 *     <div ...>TRIGGER</div>    ← optional
 *     <div ...>
 *       <div ...><div>...</div><div class="flex-1 ...">LINE</div></div>
 *       ...
 *     </div>
 *   </div>
 */
function parseSignature(html: string): KitCard | null {
  const h2Re = /<h2[^>]*>\s*Signature Ability[^<]*<\/h2>/i;
  const h2Match = h2Re.exec(html);
  if (!h2Match) return null;
  const after = h2Match.index + h2Match[0].length;
  // The next <section> close (or until "Abilities" h2) bounds us.
  const sectionEnd = html.indexOf('</section>', after);
  if (sectionEnd === -1) return null;
  const block = html.slice(after, sectionEnd);

  // Title: the first <div ...font-semibold...>TITLE</div> after the h2.
  const titleMatch =
    /<div[^>]*font-semibold[^>]*text-sm[^>]*text-gray-200[^>]*>\s*([\s\S]*?)\s*<\/div>/i.exec(
      block,
    );
  const title = titleMatch ? plainText(titleMatch[1]!) : '';

  // Trigger: optional <div ...font-medium text-sm>TRIGGER</div> after title.
  const triggerMatch =
    /<div[^>]*py-1\.5[^>]*font-medium[^>]*>\s*([\s\S]*?)\s*<\/div>/i.exec(
      block,
    );
  const trigger = triggerMatch ? plainText(triggerMatch[1]!) : '';

  const lines = extractKitLines(block);
  if (!title && lines.length === 0) return null;
  return { title, trigger, lines };
}

/** Lift every `<div class="flex-1 text-xs sm:text-sm leading-relaxed">…</div>`
 *  body as a kit line. These are MCOCHUB's per-bullet text. */
function extractKitLines(html: string): string[] {
  const out: string[] = [];
  const re =
    /<div[^>]*class="[^"]*flex-1[^"]*text-xs[^"]*sm:text-sm[^"]*leading-relaxed[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const line = plainText(m[1]!);
    if (line) out.push(line);
  }
  return out;
}

/**
 * Parse the Abilities cards: every <details><summary>TITLE - TRIGGER</summary>
 * <div ...>...lines...</div></details> under the <h2>Abilities</h2> section.
 * The summary often arrives in ALL CAPS with HTML colouring (e.g.
 * "<span style="color:#c04a4a">CORRUPTION</span> - PASSIVE"). We split on
 * the LAST " - " separator so multi-dash titles parse correctly.
 */
function parseAbilityCards(html: string): KitCard[] {
  const out: KitCard[] = [];
  // Find the Abilities <h2> (not the Signature Ability one).
  const re = /<h2[^>]*>\s*Abilities\s*<\/h2>/i;
  const m = re.exec(html);
  if (!m) return out;
  const start = m.index + m[0].length;
  // Bound by next <h2> or end of file.
  const nextH2 = html.indexOf('<h2', start);
  const block = html.slice(start, nextH2 === -1 ? undefined : nextH2);

  const detailsRe = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = detailsRe.exec(block)) !== null) {
    const inner = dm[1]!;
    const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
    const summaryRaw = summaryMatch ? summaryMatch[1]! : '';
    const summary = plainText(summaryRaw);
    let title = summary;
    let trigger = '';
    const sep = ' - ';
    const lastSep = summary.lastIndexOf(sep);
    if (lastSep > 0) {
      title = summary.slice(0, lastSep).trim();
      trigger = summary.slice(lastSep + sep.length).trim();
    }
    const lines = extractKitLines(inner);
    if (title || lines.length > 0) {
      out.push({ title, trigger, lines });
    }
  }
  return out;
}

function parseChampionPage(html: string, slug: string): ChampionAbilities {
  const url = `${BASE_URL}/${slug}`;
  const abilitiesPills = (() => {
    const s = findPillSection(html, 'Abilities', 'slate');
    return s ? parsePills(s) : [];
  })();
  const immunitiesPills = (() => {
    const s = findPillSection(html, 'Immunities', 'emerald');
    return s ? parsePills(s) : [];
  })();
  const tagsContainer = findPillSection(html, 'Tags', 'indigo');
  const tags = tagsContainer ? parseTags(tagsContainer) : [];
  return {
    source: { slug, url },
    pills: {
      abilities: abilitiesPills,
      immunities: immunitiesPills,
      tags,
    },
    kit: {
      signature: parseSignature(html),
      cards: parseAbilityCards(html),
    },
  };
}

// ─── Orchestration ───────────────────────────────────────────────────────

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
    champions: SeedChampion[];
  };

  console.log('Loading MCOCHUB champions index…');
  const indexByName = await loadMcochubIndex();
  console.log(`Indexed ${indexByName.size} MCOCHUB champion slugs.`);

  let targets = seed.champions.filter((c) => c.sevenStarReleased !== false);
  if (ONLY_IDS) targets = targets.filter((c) => ONLY_IDS.includes(c.id));
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(`Processing ${targets.length} champion(s)…`);
  if (NO_CACHE) console.log('Cache disabled — re-fetching every page.');

  const out: Record<string, ChampionAbilities> = {};
  const unresolved: Array<{ id: string; name: string; tried: string[] }> = [];
  let i = 0;
  for (const c of targets) {
    i++;
    const tried = slugCandidates(c, indexByName);
    let html: string | null = null;
    let usedSlug = '';
    for (const candidate of tried) {
      html = await fetchPage(candidate);
      if (html) {
        usedSlug = candidate;
        break;
      }
      await sleep(RATE_LIMIT_MS);
    }
    if (!html) {
      console.warn(`  ⚠ [${i}/${targets.length}] ${c.name} (id=${c.id}) — no MCOCHUB page found`);
      unresolved.push({ id: c.id, name: c.name, tried });
      continue;
    }
    try {
      const parsed = parseChampionPage(html, usedSlug);
      out[c.id] = parsed;
      const pillCount =
        parsed.pills.abilities.length +
        parsed.pills.immunities.length +
        parsed.pills.tags.length;
      const cardCount = parsed.kit.cards.length;
      console.log(
        `  ✓ [${i}/${targets.length}] ${c.name} → ${usedSlug} (${pillCount} pills, ${cardCount} kit cards)`,
      );
    } catch (err) {
      console.warn(`  ⚠ [${i}/${targets.length}] ${c.name} (id=${c.id}) — parse failed: ${(err as Error).message}`);
      unresolved.push({ id: c.id, name: c.name, tried });
    }
    await sleep(RATE_LIMIT_MS);
  }

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    version: '1',
    source: 'MCOCHUB (https://mcochub.insaneskull.com)',
    lastImported: today,
    champions: out,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(
    UNRESOLVED_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), unresolved },
      null,
      2,
    ) + '\n',
  );

  console.log('');
  console.log(`Wrote ${Object.keys(out).length} champion ability records → ${OUTPUT_PATH}`);
  console.log(`Unresolved: ${unresolved.length}; see ${UNRESOLVED_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
