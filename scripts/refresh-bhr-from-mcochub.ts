/**
 * Refresh every champion's full 11-anchor R5 sig curve from MCOCHUB.
 *
 * MCOCHUB publishes BHR at sig 0/20/40/60/80/100/120/140/160/180/200 for
 * every 7-star R5 champion on https://mcochub.insaneskull.com/prestige.
 * The current seed only stores sig 0 and sig 200, which forces the engine
 * onto a global rank-default curve — that curve is wrong for many
 * champions, producing BHR errors of up to ~5% at mid-sig states.
 *
 * Strategy:
 *   1. Fetch the prestige page (server-side rendered HTML; no JS / no auth).
 *   2. Walk every <tr>; extract champion name, tier, rank, and the 11 BHR
 *      cells. Keep only tier=7 rank=5 rows.
 *   3. Reconcile MCOCHUB names against seed.json ids using a hyphen + case
 *      normalisation ladder (same as refresh-classes-from-fandom.ts).
 *   4. Dry-run: write proposals to scripts/bhr-corrections.json.
 *   5. --apply: rewrite seed.json, backing up to seed.json.bak.
 *
 * Polite: identifying User-Agent. Single GET. No rate limit needed for one
 * request, but we still respect the site by not hammering it.
 * Idempotent: re-running on already-correct data writes zero corrections.
 *
 * Usage:
 *   pnpm refresh-bhr                       # dry-run
 *   pnpm refresh-bhr -- --apply            # apply previously-saved corrections
 *   pnpm refresh-bhr -- --refresh-apply    # one-shot: fetch + immediately apply
 *
 * Output:
 *   scripts/bhr-corrections.json — { corrections: [...], unmatched: [...] }
 *   data/champions/seed.json.bak — backup before --apply (every apply)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';

const SEED_PATH = 'data/champions/seed.json';
const CORRECTIONS_PATH = 'scripts/bhr-corrections.json';
const SEED_BACKUP_PATH = 'data/champions/seed.json.bak';
const SOURCE_URL = 'https://mcochub.insaneskull.com/prestige';
const USER_AGENT =
  'mcoc.help BHR refresher (free MCOC tool; contact via mcoc.help)';
const FETCH_TIMEOUT_MS = 30000;

const SIG_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200] as const;

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY_ONLY = args.includes('--apply');
const REFRESH_APPLY = args.includes('--refresh-apply');

// ─── Types ──────────────────────────────────────────────────────────────

type ScrapedRow = {
  name: string;
  /** Image filename slug from MCOCHUB's CDN URL — used as a fallback id
   *  match when name strings diverge between MCOCHUB and our seed. */
  slug: string;
  tier: number;
  rank: number;
  /** Sparse map sig → BHR. All 11 anchors expected for tier=7 rank=5 rows. */
  brackets: Record<string, number>;
};

type Champion = {
  id: string;
  name: string;
  prestige: { rank5: Record<string, number> } & Record<string, unknown>;
  _meta?: { bhrSource?: string; lastVerified?: string } & Record<string, unknown>;
  [k: string]: unknown;
};

type Correction = {
  id: string;
  name: string;
  oldBrackets: Record<string, number>;
  newBrackets: Record<string, number>;
  sourceSlug: string;
};

// ─── Fetch + parse ──────────────────────────────────────────────────────

async function fetchPrestigePage(): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) {
      throw new Error(`Unexpected content-type: ${ct}`);
    }
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull champion rows out of MCOCHUB's HTML.
 *
 * Each data row has the shape (whitespace varies):
 *   <tr>
 *     <td>RANK#</td>
 *     <td><img ...src="...../champs/SLUG.png" alt="NAME" title="NAME">...</td>
 *     <td>TIER</td>
 *     <td>RANK</td>
 *     <td>SIG0</td>  ... 11 numeric cells ...
 *     <td>SIG200</td>
 *   </tr>
 *
 * We slice the body by `<tr>`, then for each row extract the bits we need
 * with focused regexes. A single dependency-free pass — cheap and stable
 * unless MCOCHUB rewrites the row template.
 */
function parsePrestigeRows(html: string): ScrapedRow[] {
  const out: ScrapedRow[] = [];
  // Split on opening <tr — first chunk is the head, rest are rows. Each row
  // chunk contains everything up to (and including) the next <tr or EOF.
  const chunks = html.split(/<tr\b/i);
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    // Champion identification: prefer the title attribute (cleanest), then
    // the image slug as a fallback (used for id reconciliation).
    const nameMatch = chunk.match(/title=\s*"([^"]+)"/);
    // MCOCHUB stores portraits as .png (legacy) or .webp (newer rows like
    // Bastion). Some slugs contain unescaped apostrophes (chee'ilth.webp).
    // Accept any non-slash/non-dot path segment ending in a known image ext.
    const slugMatch = chunk.match(/\/champs\/([^/.]+)\.(?:png|webp|jpg|jpeg)\b/i);
    if (!nameMatch || !slugMatch) continue;
    const name = nameMatch[1]!.trim();
    const slug = slugMatch[1]!.trim();

    // Numeric cells: every <td>...</td> whose body is digits. MCOCHUB's
    // template renders BHR values without commas or formatting so this is
    // straightforward.
    const numericCells: number[] = [];
    const cellRe = /<td\b[^>]*>\s*(\d+)\s*<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(chunk)) !== null) {
      numericCells.push(Number(m[1]!));
    }

    // Layout: [rowNum, tier, rank, sig0, sig20, …, sig200] → 14 numeric cells.
    if (numericCells.length < 14) continue;
    const tier = numericCells[1]!;
    const rank = numericCells[2]!;
    const bhrValues = numericCells.slice(3, 14);
    if (bhrValues.length !== SIG_ANCHORS.length) continue;

    const brackets: Record<string, number> = {};
    for (let j = 0; j < SIG_ANCHORS.length; j++) {
      brackets[String(SIG_ANCHORS[j])] = bhrValues[j]!;
    }
    out.push({ name, slug, tier, rank, brackets });
  }
  return out;
}

// ─── Reconciliation ─────────────────────────────────────────────────────

/** Canonicalise to a comparison key: lowercase, strip non-alphanumeric. */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Same idea but with hyphens preserved as separators, matching seed ids. */
function normaliseSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find the seed champion that corresponds to a scraped MCOCHUB row.
 * Ladder:
 *   1. Exact slug → id match.
 *   2. Normalised slug → id match (handles spider_man vs spider-man).
 *   3. Normalised display-name → name match (handles "Spider-Man (Stark)"
 *      vs "Spider-Man Stark").
 */
function findSeedMatch(row: ScrapedRow, byId: Map<string, Champion>, byNameNorm: Map<string, Champion>) {
  const direct = byId.get(row.slug);
  if (direct) return direct;
  const slugNorm = normaliseSlug(row.slug);
  if (slugNorm !== row.slug) {
    const v = byId.get(slugNorm);
    if (v) return v;
  }
  return byNameNorm.get(normaliseName(row.name)) ?? null;
}

// ─── Diff ───────────────────────────────────────────────────────────────

/** Two bracket maps are equivalent when every populated key matches. */
function bracketsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return keys.size > 0;
}

// ─── Seed I/O ───────────────────────────────────────────────────────────

function readSeed(): { champions: Champion[] } {
  return JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { champions: Champion[] };
}
function writeSeed(seed: { champions: Champion[] }) {
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
}

// ─── Apply ──────────────────────────────────────────────────────────────

function applyCorrections() {
  if (!existsSync(CORRECTIONS_PATH)) {
    console.error(`No corrections file at ${CORRECTIONS_PATH}. Run a dry-run first.`);
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')) as {
    corrections: Correction[];
  };
  if (file.corrections.length === 0) {
    console.log('No corrections to apply. seed.json untouched.');
    return;
  }
  console.log(`Backing up seed.json → ${SEED_BACKUP_PATH}`);
  copyFileSync(SEED_PATH, SEED_BACKUP_PATH);

  const seed = readSeed();
  const byId = new Map(seed.champions.map((c) => [c.id, c]));
  let applied = 0;
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const corr of file.corrections) {
    const champ = byId.get(corr.id);
    if (!champ) {
      console.warn(`  ⚠ ${corr.name} (id=${corr.id}): not in seed, skipping`);
      skipped++;
      continue;
    }
    champ.prestige.rank5 = corr.newBrackets;
    if (champ._meta) {
      champ._meta.bhrSource = `mcochub.insaneskull.com (11-anchor R5 curve, refreshed ${today})`;
      champ._meta.lastVerified = today;
    }
    applied++;
  }
  writeSeed(seed);
  console.log(
    `\nApplied ${applied} BHR refresh${applied === 1 ? '' : 'es'}` +
      (skipped > 0 ? ` (${skipped} skipped — see warnings above)` : '') +
      `. seed.json updated.`,
  );
}

// ─── Dry-run ────────────────────────────────────────────────────────────

async function dryRun() {
  console.log(`Fetching ${SOURCE_URL}…`);
  let html: string;
  try {
    html = await fetchPrestigePage();
  } catch (e) {
    console.error(`Fetch failed: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(`Fetched ${html.length.toLocaleString()} bytes.`);

  const allRows = parsePrestigeRows(html);
  const r5Rows = allRows.filter((r) => r.tier === 7 && r.rank === 5);
  console.log(
    `Parsed ${allRows.length} row${allRows.length === 1 ? '' : 's'}, ${r5Rows.length} at tier=7 rank=5.`,
  );

  const seed = readSeed();
  const byId = new Map(seed.champions.map((c) => [c.id, c]));
  const byNameNorm = new Map(
    seed.champions.map((c) => [normaliseName(c.name), c] as const),
  );

  const corrections: Correction[] = [];
  const unmatched: ScrapedRow[] = [];
  let unchanged = 0;

  for (const row of r5Rows) {
    const seedChamp = findSeedMatch(row, byId, byNameNorm);
    if (!seedChamp) {
      unmatched.push(row);
      continue;
    }
    const oldBrackets = seedChamp.prestige.rank5 as Record<string, number>;
    if (bracketsEqual(oldBrackets, row.brackets)) {
      unchanged++;
      continue;
    }
    corrections.push({
      id: seedChamp.id,
      name: seedChamp.name,
      oldBrackets,
      newBrackets: row.brackets,
      sourceSlug: row.slug,
    });
  }

  writeFileSync(
    CORRECTIONS_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: SOURCE_URL,
        corrections,
        unmatched: unmatched.map((u) => ({ name: u.name, slug: u.slug })),
      },
      null,
      2,
    ) + '\n',
  );

  console.log('');
  console.log('─'.repeat(60));
  console.log(`Unchanged:        ${unchanged}`);
  console.log(`Corrections:      ${corrections.length}`);
  console.log(`Unmatched on MCOCHUB side: ${unmatched.length}`);
  console.log(`Total R5 rows:    ${r5Rows.length}`);
  console.log('');
  if (corrections.length > 0) {
    console.log(`Corrections written to: ${CORRECTIONS_PATH}`);
    console.log('Review the file, then:');
    console.log('  pnpm refresh-bhr -- --apply');
  }
  if (unmatched.length > 0) {
    console.log('');
    console.log('Unmatched MCOCHUB rows (no corresponding seed entry):');
    for (const u of unmatched.slice(0, 10)) {
      console.log(`  ${u.name.padEnd(40)} slug=${u.slug}`);
    }
    if (unmatched.length > 10) {
      console.log(`  … and ${unmatched.length - 10} more`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

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

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
