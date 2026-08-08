/**
 * Fetch champion kit text from the Marvel Contest of Champions Fandom
 * wiki for champions whose MCOCHUB page is thin (Kabam-recent buffs
 * that MCOCHUB's maintainers haven't transcribed yet).
 *
 * MCOCHUB is our primary source (auto-updated, structured pills + kit
 * cards). Fandom is a supplementary text source we render as a
 * separate "via Fandom wiki" panel on the champion detail page — same
 * treatment as the existing auntm.ai passives card. We don't try to
 * merge into MCOCHUB's shape (pill vs prose is a lossy conversion);
 * the two data sources sit side-by-side and the reader gets the
 * fuller picture.
 *
 * We consume three sections per champion (indices vary by page — we
 * find them by title, not index):
 *   Abilities         (paragraphs + sub-headings for each innate/passive)
 *   Signature Ability (usually 1 block, sometimes tier tables)
 *   Special Attacks   (SP1 / SP2 / SP3 descriptions)
 *
 * Wiki tables (tier progression) get replaced with a "[tier scaling
 * table on Fandom]" placeholder. They're numeric-heavy and don't read
 * well as prose. Users who want the numbers follow the linked page.
 *
 * Rate limit 1 req/sec. Cached per-champion HTML in .cache/fandom-kits/
 * so re-runs are cheap.
 *
 * Usage:
 *   pnpm refresh-abilities-fandom                # defaults to the ids listed
 *                                                # in DEFAULT_TARGETS below
 *   pnpm refresh-abilities-fandom -- --ids spider-man-symbiote,kang-the-conqueror
 *   pnpm refresh-abilities-fandom -- --no-cache  # bypass the per-page cache
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SEED_PATH = 'data/champions/seed.json';
const OUTPUT_PATH = 'data/champions/abilities-fandom.json';
const CACHE_DIR = '.cache/fandom-kits';
const FANDOM_API = 'https://marvel-contestofchampions.fandom.com/api.php';
const USER_AGENT =
  'mcoc.help fandom kit fallback scraper (free MCOC tool; contact via mcoc.help)';
const RATE_LIMIT_MS = 1_000;
const FETCH_TIMEOUT_MS = 30_000;

/** Fallback targets when --ids isn't set. Extend as MCOCHUB coverage gaps
 *  turn up. Keep this list conservative — we spend an API call per entry. */
const DEFAULT_TARGETS = ['spider-man-symbiote'];

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}
const ONLY_IDS = flagValue('--ids')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const NO_CACHE = args.includes('--no-cache');

// ─── Types ──────────────────────────────────────────────────────────────

type SeedChampion = { id: string; name: string; sevenStarReleased?: boolean };
type SeedFile = { champions: SeedChampion[] };

type FandomCard = {
  /** Sub-heading text as it appears on Fandom (e.g. "Critical Hits",
   *  "Special 1 - Web-Slinger"). May be empty when the section has
   *  unlabelled leading prose. */
  title: string;
  lines: string[];
};

type FandomSection = {
  /** "Abilities" / "Signature Ability" / "Special Attacks". */
  title: string;
  cards: FandomCard[];
};

type FandomChampion = {
  source: { pageTitle: string; url: string; capturedAt: string };
  sections: FandomSection[];
};

// ─── Fetch helpers ─────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cachePath(pageTitle: string, sectionKey: string): string {
  const safe = `${pageTitle}__${sectionKey}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return join(CACHE_DIR, `${safe}.json`);
}

async function fandomApi<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(FANDOM_API);
  url.search = new URLSearchParams({ ...params, format: 'json' }).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type SectionsResponse = {
  parse?: {
    sections: Array<{ line: string; index: string; level: string }>;
  };
};

type TextResponse = { parse?: { text: { '*': string } } };

/** Fandom page title = champion name with spaces → underscores. Fandom's
 *  case + punctuation is already what our seed.name uses. */
function pageTitleFor(name: string): string {
  return name.replace(/\s+/g, '_');
}

/**
 * Resolve section titles to their current numeric indices — the page can
 * add/remove sections between champions (some pages have a "Buff Notes"
 * block, others don't) so hard-coding indices would silently break.
 */
async function loadSectionIndices(
  pageTitle: string,
): Promise<Map<string, string>> {
  const cachedAt = cachePath(pageTitle, 'sections');
  let res: SectionsResponse;
  if (!NO_CACHE && existsSync(cachedAt)) {
    res = JSON.parse(readFileSync(cachedAt, 'utf8')) as SectionsResponse;
  } else {
    res = await fandomApi<SectionsResponse>({
      action: 'parse',
      page: pageTitle,
      prop: 'sections',
    });
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachedAt, JSON.stringify(res, null, 2));
  }
  const map = new Map<string, string>();
  for (const s of res.parse?.sections ?? []) {
    // Fandom emits some section titles with a trailing space — normalise.
    map.set(s.line.trim(), s.index);
  }
  return map;
}

async function fetchSectionHtml(
  pageTitle: string,
  sectionIndex: string,
  sectionLabel: string,
): Promise<string> {
  const cachedAt = cachePath(pageTitle, `sec_${sectionIndex}_${sectionLabel}`);
  if (!NO_CACHE && existsSync(cachedAt)) {
    const cached = JSON.parse(readFileSync(cachedAt, 'utf8')) as TextResponse;
    return cached.parse?.text['*'] ?? '';
  }
  const res = await fandomApi<TextResponse>({
    action: 'parse',
    page: pageTitle,
    prop: 'text',
    section: sectionIndex,
  });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachedAt, JSON.stringify(res, null, 2));
  return res.parse?.text['*'] ?? '';
}

// ─── HTML → cards ──────────────────────────────────────────────────────

/** Strip HTML tags, decode common entities, collapse whitespace. */
function plainText(html: string): string {
  return (
    html
      // Kill Fandom's [edit] links inside <span class="mw-editsection">.
      .replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
      // Kill footnote refs.
      .replace(/<sup[^>]*class="[^"]*reference[^"]*"[^>]*>[\s\S]*?<\/sup>/g, '')
      // Kill image markup — leaves text alt where present.
      .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, ' $1 ')
      .replace(/<img[^>]*>/g, ' ')
      // Kill remaining tags.
      .replace(/<[^>]+>/g, ' ')
      // Decode entities we're likely to see.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&#(\d+);/g, (_, dec: string) =>
        String.fromCodePoint(parseInt(dec, 10)),
      )
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&rsquo;|&lsquo;|&apos;/g, "'")
      .replace(/&rdquo;|&ldquo;|&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&hellip;/g, '…')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      // Collapse whitespace and trim.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Split a section's HTML into cards. Fandom's convention for ability
 * sub-headings inside a section like "Abilities" or "Special Attacks"
 * is a bold-only paragraph — `<p><b>Critical Hits</b></p>`,
 * `<p><b>Special 1 - Web-Slinger</b></p>` — not a real heading tag.
 * We split on those boundaries. The section's own H2 header is
 * dropped first so its text doesn't bleed into the first card.
 *
 * Wiki tables (tier scaling) are replaced with a marker before the
 * tag strip; we don't try to prose-ify them.
 */
function parseSectionCards(html: string): FandomCard[] {
  // Kill the leading H2 section header — we already carry the section
  // title on the payload. Otherwise its text ("Abilities") shows up
  // as the first prose fragment.
  const noSectionHeader = html.replace(
    /<h2\b[^>]*>[\s\S]*?<\/h2>/i,
    '',
  );
  // Replace tables with a placeholder so we keep the semantic that a
  // tier scaling table lived here. Match greedily across newlines.
  const withTablesMarked = noSectionHeader.replace(
    /<table\b[\s\S]*?<\/table>/gi,
    '<p>[tier scaling table on Fandom]</p>',
  );

  // Cut on paragraphs whose first content is a `<b>` block:
  //   `<p><b>Card Title</b></p>`                          — sub-heading only
  //   `<p><b>Symbiotic Enhancement</b> - Special Attacks</p>` — title + trigger label
  //   `<p><b>Special 1 - Web-Slinger</b><br /><i>…</i></p>` — sub-heading + prose
  // Any of these shapes marks a new card. We consume `<p …><b …>TITLE</b>`
  // plus whatever plain text or `-` fragment sits between the </b> and
  // the next <br>/</p> (Fandom's "trigger label" convention), and
  // fold that into the card title as "Title — Trigger" to match how
  // MCOCHUB's cards already read (title + trigger separated by an
  // em-dash). Real prose after that becomes the card body.
  const HEADER_RE = /<p\b[^>]*>\s*<b\b[^>]*>([\s\S]*?)<\/b>([^<]*)/gi;
  const boundaries: Array<{ index: number; length: number; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = HEADER_RE.exec(withTablesMarked)) !== null) {
    const boldText = plainText(m[1] ?? '');
    const trailingText = plainText(m[2] ?? '')
      .replace(/^[\s-–—:·]+/, '')
      .trim();
    const title = trailingText
      ? `${boldText} — ${trailingText}`
      : boldText;
    boundaries.push({
      index: m.index,
      length: m[0].length,
      title,
    });
  }

  const cards: FandomCard[] = [];
  const cutPoints = [
    ...boundaries.map((b) => ({ start: b.index, end: b.index + b.length, title: b.title })),
    { start: withTablesMarked.length, end: withTablesMarked.length, title: '' },
  ];

  // Leading fragment before the first bold header (if any). Rare —
  // some sections have unlabelled prose before the first sub-heading.
  const firstStart = cutPoints[0]?.start ?? withTablesMarked.length;
  if (firstStart > 0) {
    const leading = extractLines(withTablesMarked.slice(0, firstStart));
    if (leading.length > 0) cards.push({ title: '', lines: leading });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const cur = boundaries[i]!;
    const bodyStart = cur.index + cur.length;
    const bodyEnd = boundaries[i + 1]?.index ?? withTablesMarked.length;
    const body = withTablesMarked.slice(bodyStart, bodyEnd);
    const lines = extractLines(body);
    // Emit even empty-body cards so the title survives; readers can
    // follow the source link for the details.
    cards.push({ title: cur.title, lines });
  }

  return cards;
}

/**
 * Slice a card body into readable lines. Splits on block-level tag
 * boundaries (</p>, </li>, <br>) — nested inline markup is fine
 * because plainText strips it.
 */
function extractLines(body: string): string[] {
  return body
    .split(/(?:<\/p>|<\/li>|<br\s*\/?>)/i)
    .map((c) => plainText(c))
    .filter((c) => c.length > 0);
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as SeedFile;
  const byId = new Map(seed.champions.map((c) => [c.id, c]));
  const targets = (ONLY_IDS ?? DEFAULT_TARGETS).filter((id) => {
    const c = byId.get(id);
    if (!c) console.warn(`  ⚠ Skipping ${id}: not in seed`);
    return !!c;
  });
  if (targets.length === 0) {
    console.error('No valid targets. Nothing to do.');
    process.exit(1);
  }

  console.log(`Fetching Fandom kit fallback for ${targets.length} champion(s)…`);
  if (NO_CACHE) console.log('Cache disabled — re-fetching every page.');

  const wanted = ['Abilities', 'Signature Ability', 'Special Attacks'];
  const out: Record<string, FandomChampion> = {};
  const today = new Date().toISOString().slice(0, 10);

  // Preserve existing entries for champs not in this run (merge, don't
  // replace). Same design guardrail as the MCOCHUB scoped-refresh fix.
  if (existsSync(OUTPUT_PATH)) {
    const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as {
      champions: Record<string, FandomChampion>;
    };
    for (const [id, entry] of Object.entries(existing.champions ?? {})) {
      if (!targets.includes(id)) out[id] = entry;
    }
  }

  let i = 0;
  for (const id of targets) {
    i++;
    const champ = byId.get(id)!;
    const pageTitle = pageTitleFor(champ.name);
    console.log(`  [${i}/${targets.length}] ${champ.name} → ${pageTitle}`);

    let sectionMap: Map<string, string>;
    try {
      sectionMap = await loadSectionIndices(pageTitle);
    } catch (err) {
      console.warn(`    ✗ Section index fetch failed: ${(err as Error).message}`);
      continue;
    }
    await sleep(RATE_LIMIT_MS);

    const sections: FandomSection[] = [];
    for (const label of wanted) {
      const idx = sectionMap.get(label);
      if (!idx) {
        console.warn(`    ⚠ No "${label}" section on this page.`);
        continue;
      }
      let html: string;
      try {
        html = await fetchSectionHtml(pageTitle, idx, label);
      } catch (err) {
        console.warn(
          `    ✗ Section "${label}" fetch failed: ${(err as Error).message}`,
        );
        continue;
      }
      await sleep(RATE_LIMIT_MS);
      const cards = parseSectionCards(html);
      if (cards.length === 0) continue;
      sections.push({ title: label, cards });
      const lineCount = cards.reduce((n, c) => n + c.lines.length, 0);
      console.log(`      ✓ "${label}": ${cards.length} cards, ${lineCount} lines`);
    }

    if (sections.length === 0) {
      console.warn(`    ⚠ ${champ.name}: no usable sections extracted.`);
      continue;
    }

    out[id] = {
      source: {
        pageTitle,
        url: `https://marvel-contestofchampions.fandom.com/wiki/${pageTitle}`,
        capturedAt: today,
      },
      sections,
    };
  }

  const payload = {
    _meta: {
      note:
        'Fandom-wiki kit-text fallback for champions whose MCOCHUB page is ' +
        'thin (typically post-buff, before MCOCHUB catches up). The web app ' +
        "renders this alongside MCOCHUB's kit as a separate 'via Fandom' " +
        'panel — same treatment as auntm.ai passives. Wiki-table tier ' +
        "scaling is replaced with a '[tier scaling table on Fandom]' marker " +
        'and readers follow the source link for the numbers.',
      source: 'marvel-contestofchampions.fandom.com (MediaWiki parse API)',
      generatedAt: today,
    },
    champions: Object.fromEntries(
      Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log('');
  console.log(
    `Wrote ${Object.keys(out).length} Fandom champion entr${Object.keys(out).length === 1 ? 'y' : 'ies'} → ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
