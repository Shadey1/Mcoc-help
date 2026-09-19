/**
 * War planner — Alliance War season extractor.
 *
 * Usage:
 *   tsx scripts/extract-aw-season.ts <season-number> [--fetch] [--apply]
 *   tsx scripts/extract-aw-season.ts <season-number> --check
 *
 * With --fetch, downloads the guide page's images into
 * `dump/aw-season-<N>/` first; otherwise reuses the last download.
 * Writes:
 *
 *   data/aw/season-<N>.json       — 50 nodes: buffs + up to 8 defender ids
 *   data/aw/_review-season-<N>.md — only the cells/nodes it wasn't sure of
 *   data/aw/_cells-s<N>/          — crops of the flagged cells
 *
 * Nothing about the page layout is hardcoded: table images are found by
 * their "Node / Defenders / Attackers" header colours, rows by the
 * separator bars, node numbers and buff text by OCR, and defenders by
 * template-matching against data/champions/portraits-cache/ (built by
 * scripts/fetch-portrait-cache.ts).
 *
 * --check downloads the guide and only reports whether its pick tables
 * changed since the season file was written (exit 0 same, 2 changed).
 *
 * Dry-run by default. Pass --apply to write the files.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { loadRefs, matchCell, type Match, type Ref } from './lib/portrait-match.js';
import { Season } from '../data/aw/season-69.schema.js';
import { fetchGuideImages } from './lib/fetch-guide.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');
const FETCH = args.includes('--fetch') || CHECK;
const positional = args.filter((a) => !a.startsWith('--'));
if (positional.length < 1) {
  console.error('Usage: tsx scripts/extract-aw-season.ts <season-number> [--fetch] [--apply]');
  process.exit(64);
}
const SEASON = parseInt(positional[0]!, 10);
if (!Number.isInteger(SEASON) || SEASON < 1) {
  console.error('Invalid season number.');
  process.exit(64);
}

const REPO_ROOT = resolve(import.meta.dirname, '..');
const GUIDE_URL = `https://www.guiamtc.com/aw-season-${SEASON}`;
const FETCHED_DIR = resolve(REPO_ROOT, `dump/aw-season-${SEASON}`);
// A browser "Save Page As" folder still works if the download ever breaks.
const SAVED_DIR = resolve(REPO_ROOT, `dump/MTC Guide - AW - Season ${SEASON}_files`);
let DUMP = FETCHED_DIR;
const PORTRAITS_DIR = resolve(REPO_ROOT, 'data/champions/portraits-cache');
const SEED_PATH = resolve(REPO_ROOT, 'data/champions/seed.json');
const SEASON_FILE = resolve(REPO_ROOT, `data/aw/season-${SEASON}.json`);
const REVIEW_FILE = resolve(REPO_ROOT, `data/aw/_review-season-${SEASON}.md`);
const CELLS_DIR = resolve(REPO_ROOT, `data/aw/_cells-s${SEASON}`);

// True matches score 0.82-0.99 with the runner-up near 0.45-0.65; the
// lead over the runner-up is the real confidence signal.
const SCORE_OK = 0.75;
const MIN_GAP = 0.15;
// A cell whose pixels barely vary is an empty slot (flat cell shading).
const EMPTY_CELL_STDDEV = 12;

// ── Table geometry ──────────────────────────────────────────────────────

type Box = { left: number; top: number; width: number; height: number };
type Table = { file: string; path: string; defenders: { left: number; width: number }; rows: Array<{ top: number; bottom: number }> };

type Pixels = { data: Buffer; W: number; H: number };

async function loadPixels(path: string): Promise<Pixels> {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

/** Widest x-span on scanline y whose pixels satisfy `is`, bridging the
 *  gap the header's white label text punches into the colour run. */
function headerSpan(p: Pixels, y: number, is: (r: number, g: number, b: number) => boolean): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < p.W; x++) {
    const i = (y * p.W + x) * 3;
    if (is(p.data[i]!, p.data[i + 1]!, p.data[i + 2]!)) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 || last - first < 100 ? null : [first, last];
}

/** Find the Node/Defenders/Attackers header and the row bands under it.
 *  Returns null for images that aren't pick tables. */
async function readTable(file: string): Promise<Table | null> {
  const path = resolve(DUMP, file);
  const p = await loadPixels(path);
  if (p.W < 800 || p.H < 300) return null;

  let headerY = -1;
  let red: [number, number] | null = null;
  for (let y = 40; y < Math.min(200, p.H); y += 2) {
    const r = headerSpan(p, y, (R, G, B) => R > 70 && G < 40 && B < 40);
    const g = headerSpan(p, y, (R, G, B) => G > 60 && R < 40 && B < 40);
    const b = headerSpan(p, y, (R, G, B) => B > 60 && R < 40 && G < 60);
    if (r && g && b && b[0] < r[0] && r[1] < g[0]) {
      headerY = y;
      red = r;
      break;
    }
  }
  if (headerY < 0 || !red) return null;

  // Rows: the last few px of the buff cell (just left of the defenders
  // column) are light and text-free inside a row, dark on separators.
  const stripX0 = red[0] - 10;
  const stripX1 = red[0] - 6;
  const rows: Table['rows'] = [];
  let start = -1;
  for (let y = headerY; y < p.H; y++) {
    let s = 0;
    for (let x = stripX0; x < stripX1; x++) {
      const i = (y * p.W + x) * 3;
      s += p.data[i]! + p.data[i + 1]! + p.data[i + 2]!;
    }
    const light = s / ((stripX1 - stripX0) * 3) > 150;
    if (light && start < 0) start = y;
    if ((!light || y === p.H - 1) && start >= 0) {
      if (y - start > 80) rows.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }
  if (rows.length === 0) return null;
  return {
    file,
    path,
    defenders: { left: red[0], width: red[1] - red[0] + 1 },
    rows,
  };
}

// ── OCR ─────────────────────────────────────────────────────────────────

async function ocrPrep(path: string, box: Box, binarise = false): Promise<Buffer> {
  const crop = sharp(path).extract(box).greyscale();
  const { channels } = await crop.clone().stats();
  const dark = channels[0]!.mean < 128;
  let img = crop.resize({ width: box.width * 3, kernel: 'lanczos3' });
  if (dark) img = img.negate();
  img = img.normalise();
  if (binarise) img = img.threshold(140);
  return img.png().toBuffer();
}

async function readNodeNumber(worker: Worker, table: Table, row: Table['rows'][number]): Promise<number | null> {
  // Number cell = left ~27% of the span before the defenders column.
  const width = Math.round(table.defenders.left * 0.26);
  const box = { left: 8, top: row.top + 6, width: width - 8, height: row.bottom - row.top - 12 };
  // Binarised, or a lone "6" / "8" reads as nothing. Word mode is left
  // out on purpose: it reads "8" as "0".
  const img = await ocrPrep(table.path, box, true);
  for (const mode of [PSM.SINGLE_LINE, PSM.SINGLE_CHAR]) {
    await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '0123456789' });
    const { data } = await worker.recognize(img);
    const text = data.text.trim();
    if (text === '') continue;
    // Anything but a clean 1-50 is a misread; char mode would only
    // turn it into a plausible-looking wrong digit.
    if (!/^[0-9]{1,2}$/.test(text)) return null;
    const n = parseInt(text, 10);
    return n >= 1 && n <= 50 ? n : null;
  }
  return null;
}

// The guide's own misspellings, corrected so the app shows the in-game
// buff names. Add to this when a new season brings a new one.
const GUIDE_TYPOS: Array<[RegExp, string]> = [
  [/\bAgression\b/g, 'Aggression'],
  [/\bDauting\b/g, 'Daunting'],
  [/\bControlos\b/g, 'Controls'],
  [/\bDesintegration\b/g, 'Disintegration'],
  [/\bAdaptative\b/g, 'Adaptive'],
  // Tesseract's English model has no grave accent.
  [/D[ée]j[aà]/g, 'Déjà'],
];

function fixTypos(line: string): string {
  return GUIDE_TYPOS.reduce((l, [from, to]) => l.replace(from, to), line);
}

/** A buff can wrap: join a line onto the previous buff when that buff
 *  ends in a colon, has an unclosed parenthesis, or the line opens one. */
function joinBuffLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const prevOpen = prev !== undefined && (prev.match(/\(/g)?.length ?? 0) > (prev.match(/\)/g)?.length ?? 0);
    if (prev !== undefined && (prev.endsWith(':') || prevOpen || line.startsWith('('))) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

async function readBuffs(worker: Worker, table: Table, row: Table['rows'][number]): Promise<string[]> {
  const left = Math.round(table.defenders.left * 0.29);
  const box = {
    left,
    top: row.top + 3,
    width: table.defenders.left - 8 - left,
    height: row.bottom - row.top - 6,
  };
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: '',
  });
  const { data } = await worker.recognize(await ocrPrep(table.path, box));
  const lines = data.text
    .split('\n')
    // Trailing symbol-only tokens are the guide's emoji icons misread.
    .map((l) => l.replace(/\s+/g, ' ').replace(/(\s+[^A-Za-z0-9()\s]+)+$/, '').trim())
    .map(fixTypos)
    .filter((l) => l.length > 1);
  return joinBuffLines(lines);
}

// ── Defender cells ──────────────────────────────────────────────────────

async function cropCells(table: Table, row: Table['rows'][number]): Promise<Buffer[]> {
  const cellW = table.defenders.width / 4;
  const cellH = (row.bottom - row.top + 1) / 2;
  const cells: Buffer[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      cells.push(
        await sharp(table.path)
          .extract({
            left: Math.round(table.defenders.left + c * cellW),
            top: Math.round(row.top + r * cellH),
            width: Math.round(cellW),
            height: Math.round(cellH),
          })
          .png()
          .toBuffer(),
      );
    }
  }
  return cells;
}

async function isEmptyCell(cell: Buffer): Promise<boolean> {
  const { channels } = await sharp(cell).greyscale().stats();
  return channels[0]!.stdev < EMPTY_CELL_STDDEV;
}

// ── Main pipeline ───────────────────────────────────────────────────────

type NodeExtraction = {
  node: number;
  source: string;
  buffs: string[];
  guideDefenders: string[];
  reviewFlags: string[];
};

async function extractRow(
  node: number,
  table: Table,
  row: Table['rows'][number],
  refs: Ref[],
  worker: Worker,
): Promise<NodeExtraction> {
  const reviewFlags: string[] = [];
  const guideDefenders: string[] = [];

  const buffs = await readBuffs(worker, table, row);
  if (buffs.length === 0) reviewFlags.push('buffs: OCR read nothing');

  const cells = await cropCells(table, row);
  for (let slot = 0; slot < cells.length; slot++) {
    const cell = cells[slot]!;
    if (await isEmptyCell(cell)) continue;
    const top: Match[] = await matchCell(cell, refs, 3);
    const best = top[0]!;
    const gap = best.score - (top[1]?.score ?? 0);
    // A weak match is usually a champion we have no reference portrait
    // for; listing a wrong id is worse than listing nothing.
    const weak = best.score < SCORE_OK;
    const repeat = !weak && guideDefenders.includes(best.championId);
    if (!weak && !repeat) guideDefenders.push(best.championId);
    if (weak || repeat || gap < MIN_GAP) {
      const name = `node-${String(node).padStart(2, '0')}-slot-${slot + 1}.png`;
      if (APPLY) {
        mkdirSync(CELLS_DIR, { recursive: true });
        writeFileSync(resolve(CELLS_DIR, name), cell);
      }
      const why = weak ? 'no confident match, left out' : repeat ? 'already listed on this node, left out' : 'ambiguous';
      const alts = top.map((m) => `${m.championId} (${m.score.toFixed(2)})`).join(', ');
      reviewFlags.push(`slot ${slot + 1}: ${why} - ${alts} - crop: _cells-s${SEASON}/${name}`);
    }
  }
  return { node, source: table.file, buffs, guideDefenders, reviewFlags };
}

async function main(): Promise<void> {
  if (FETCH) {
    console.log(`fetching ${GUIDE_URL}`);
    console.log(`  saved ${await fetchGuideImages(GUIDE_URL, FETCHED_DIR)} images to ${FETCHED_DIR}`);
  }
  if (!existsSync(DUMP)) DUMP = SAVED_DIR;
  if (!existsSync(DUMP)) {
    console.error(`No guide images for season ${SEASON}. Run again with --fetch.`);
    process.exit(1);
  }
  console.log(`guide images: ${DUMP}`);
  const tables: Table[] = [];
  for (const file of readdirSync(DUMP).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()) {
    const t = await readTable(file);
    if (t) tables.push(t);
  }
  console.log(`pick tables found: ${tables.length} (${tables.reduce((n, t) => n + t.rows.length, 0)} rows)`);
  if (tables.length === 0) {
    console.error(`No pick tables among the images in ${DUMP}. Run again with --fetch, or check the guide page still uses the Node / Defenders / Attackers tables.`);
    process.exit(1);
  }

  // The guide serves byte-identical files until it is edited, so a hash
  // over the pick tables says whether anything changed.
  const hash = createHash('sha256');
  for (const t of tables) hash.update(readFileSync(t.path));
  const fingerprint = hash.digest('hex').slice(0, 16);
  const previous = existsSync(SEASON_FILE)
    ? (JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as { source?: { fingerprint?: string; capturedAt?: string } }).source
    : undefined;
  const unchanged = previous?.fingerprint === fingerprint;
  console.log(`guide fingerprint: ${fingerprint} (${unchanged ? 'same as' : 'differs from'} the season file)`);
  if (CHECK) {
    console.log(unchanged ? 'Guide unchanged.' : `Guide has changed. Run: pnpm extract-aw-season ${SEASON} --apply`);
    process.exit(unchanged ? 0 : 2);
  }

  if (!existsSync(PORTRAITS_DIR)) {
    console.error('Portrait cache not found. Run: pnpm fetch-portraits');
    process.exit(1);
  }

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as {
    champions: Array<{ id: string; name: string }>;
  };
  // A PNG left over from a champion since removed from the seed must
  // not be matchable: its id would be unknown to the app.
  const seedIds = new Set(seed.champions.map((c) => c.id));
  const refs = (await loadRefs(PORTRAITS_DIR)).filter((r) => seedIds.has(r.id));
  if (refs.length === 0) {
    console.error(`No portraits in ${PORTRAITS_DIR}. Run: pnpm fetch-portraits`);
    process.exit(1);
  }
  console.log(`reference portraits: ${refs.length}`);
  const have = new Set(refs.map((r) => r.id));
  const missing = seed.champions.filter((c) => !have.has(c.id));
  if (missing.length > 0) {
    console.warn(`  ${missing.length} seed champions have no reference portrait and can't be matched: ${missing.map((c) => c.name).join(', ')}`);
    console.warn('  Run: pnpm fetch-portraits');
  }

  if (APPLY && existsSync(CELLS_DIR)) rmSync(CELLS_DIR, { recursive: true });

  const nameById = new Map(seed.champions.map((c) => [c.id, c.name]));

  const ocrCache = resolve(REPO_ROOT, 'node_modules/.cache/tesseract');
  mkdirSync(ocrCache, { recursive: true });
  const worker = await createWorker('eng', 1, { cachePath: ocrCache });
  const byNode = new Map<number, NodeExtraction>();
  const problems: string[] = [];
  try {
    for (const table of tables) {
      const seen: number[] = [];
      for (let r = 0; r < table.rows.length; r++) {
        const row = table.rows[r]!;
        const node = await readNodeNumber(worker, table, row);
        if (node === null) {
          problems.push(`${table.file} row ${r + 1}: could not read the node number — row skipped`);
          continue;
        }
        seen.push(node);
        const dupe = byNode.get(node);
        if (dupe) {
          problems.push(`node ${node} read from both ${dupe.source} and ${table.file} row ${r + 1}: one is a misread`);
          continue;
        }
        const ext = await extractRow(node, table, row, refs, worker);
        byNode.set(node, ext);
        const names = ext.guideDefenders.map((id) => nameById.get(id) ?? id).join(', ');
        const flag = ext.reviewFlags.length > 0 ? `  ⚠ ${ext.reviewFlags.length}` : '';
        console.log(`  node ${String(node).padStart(2)} [${table.file}]: ${names}${flag}`);
        console.log(`          ${ext.buffs.join(' | ')}`);
        for (const f of ext.reviewFlags) console.log(`          ⚠ ${f}`);
      }
      // Rows in one table step by 9 (a path) or by 1 (SUBS, Boss Island).
      const steps = new Set(seen.slice(1).map((n, i) => n - seen[i]!));
      if (steps.size > 1 || ![...steps].every((d) => d === 9 || d === 1)) {
        problems.push(`${table.file}: node numbers ${seen.join(', ')} do not step by 9 or 1: check for a misread`);
      }
    }
  } finally {
    await worker.terminate();
  }

  for (let n = 1; n <= 50; n++) {
    if (!byNode.has(n)) problems.push(`node ${n} was not found in any table`);
  }

  const extractions = [...byNode.values()].sort((a, b) => a.node - b.node);
  const flaggedNodes = extractions.filter((e) => e.reviewFlags.length > 0);
  const totalFlags = flaggedNodes.reduce((n, e) => n + e.reviewFlags.length, 0);
  console.log(`\nExtracted ${extractions.length}/50 nodes; ${totalFlags} items need review; ${problems.length} structural problems.`);
  for (const p of problems) console.log(`  ✗ ${p}`);

  // Re-running replaces hand edits, so say exactly what would change.
  if (existsSync(SEASON_FILE)) {
    const current = (JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as {
      nodes: Array<{ node: number; buffs: string[]; guideDefenders: string[] }>;
    }).nodes;
    const changed = extractions.filter((e) => {
      const c = current.find((n) => n.node === e.node);
      return !c || JSON.stringify([c.buffs, c.guideDefenders]) !== JSON.stringify([e.buffs, e.guideDefenders]);
    });
    const dropped = current.filter((c) => !byNode.has(c.node)).map((c) => c.node);
    if (dropped.length > 0) console.log(`In the current season file but not extracted: ${dropped.join(', ')}`);
    console.log(
      changed.length + dropped.length === 0
        ? 'No change from the current season file.'
        : `Differs from the current season file on ${changed.length} nodes: ${changed.map((e) => e.node).join(', ')}`,
    );
  }

  if (!APPLY) {
    console.log('(dry run: pass --apply to write files)');
    return;
  }
  if (problems.length > 0) {
    console.error('Not writing: fix the structural problems above first. The season file must hold all 50 nodes.');
    process.exit(1);
  }

  const existing = existsSync(SEASON_FILE)
    ? (JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as { defaultKeyNodes?: number[] })
    : {};
  const seasonOut = {
    season: SEASON,
    source: {
      name: 'guiamtc.com',
      url: GUIDE_URL,
      // The date the guide content was captured, so it only moves when the guide does.
      capturedAt: (unchanged && previous?.capturedAt) || new Date().toISOString().slice(0, 10),
      fingerprint,
    },
    nodes: extractions.map((e) => ({
      node: e.node,
      buffs: e.buffs,
      guideDefenders: e.guideDefenders,
      ...(e.reviewFlags.length > 0 ? { reviewFlags: e.reviewFlags } : {}),
    })),
    defaultKeyNodes: existing.defaultKeyNodes ?? [48, 49, 50],
  };
  const parsed = Season.safeParse(seasonOut);
  if (!parsed.success) {
    console.error('Not writing: output fails the season schema.');
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    process.exit(1);
  }
  mkdirSync(dirname(SEASON_FILE), { recursive: true });
  writeFileSync(SEASON_FILE, JSON.stringify(seasonOut, null, 2) + '\n');
  console.log(`wrote ${SEASON_FILE}`);

  const reviewLines: string[] = [
    `# Season ${SEASON} extraction review queue`,
    '',
    `Source: ${GUIDE_URL}`,
    `Captured: ${new Date().toISOString().slice(0, 10)}`,
    '',
    totalFlags + problems.length === 0
      ? 'Nothing to review — every cell matched confidently and all 50 nodes were found.'
      : `${problems.length} structural problems, ${totalFlags} flagged items across ${flaggedNodes.length} nodes.`,
    '',
  ];
  if (problems.length > 0) {
    reviewLines.push('## Structural problems', '');
    for (const p of problems) reviewLines.push(`- ${p}`);
    reviewLines.push('');
  }
  for (const e of flaggedNodes) {
    reviewLines.push(`## Node ${e.node}`, '');
    for (const f of e.reviewFlags) reviewLines.push(`- ${f}`);
    reviewLines.push('');
  }
  writeFileSync(REVIEW_FILE, reviewLines.join('\n'));
  console.log(`wrote ${REVIEW_FILE}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
