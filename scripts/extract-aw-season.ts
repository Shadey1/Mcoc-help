/**
 * War planner — Alliance War season extractor.
 *
 * Usage:
 *   tsx scripts/extract-aw-season.ts <season-number> [--apply]
 *
 * Reads guide images from `dump/MTC Guide - AW - Season <N>_files/`
 * (Chrome "Save Page As... > Complete Webpage" output), crops each
 * defender cell, phash-matches to the portrait cache at
 * data/champions/portrait-hashes.json (built by
 * scripts/build-portrait-hash-cache.ts), and writes:
 *
 *   data/aw/season-<N>.json       — 50 nodes × up to 8 defender ids
 *   data/aw/_review-season-<N>.md — low-confidence matches (crop path
 *                                    + top-3 candidates for hand-fix)
 *
 * Node mapping across GuiaMTC's 13 pick tables:
 *   Path 1..9 images     → nodes N, N+9, N+18, N+27 for path N
 *   SUBS Section 1..3    → nodes 37-45 (grouping determined empirically)
 *   Boss Island          → nodes 46-50 in 5 rows
 *
 * Buff text is not OCR'd yet — the schema wants a string[] per node and
 * the guide's Portuguese-and-English buff labels are noisy. Existing
 * buff placeholders in the season file are preserved on overwrite.
 *
 * Dry-run by default. Pass --apply to write the files.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import sharp from 'sharp';
import { centerCropDHash, hammingHex } from './lib/phash.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const positional = args.filter((a) => !a.startsWith('--'));
if (positional.length < 1) {
  console.error('Usage: tsx scripts/extract-aw-season.ts <season-number> [--apply]');
  process.exit(64);
}
const SEASON = parseInt(positional[0]!, 10);
if (!Number.isInteger(SEASON) || SEASON < 1) {
  console.error('Invalid season number.');
  process.exit(64);
}

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DUMP = resolve(REPO_ROOT, `dump/MTC Guide - AW - Season ${SEASON}_files`);
const HASH_CACHE_PATH = resolve(REPO_ROOT, 'data/champions/portrait-hashes.json');
const SEED_PATH = resolve(REPO_ROOT, 'data/champions/seed.json');
const SEASON_FILE = resolve(REPO_ROOT, `data/aw/season-${SEASON}.json`);
const REVIEW_FILE = resolve(REPO_ROOT, `data/aw/_review-season-${SEASON}.md`);
const CELLS_DIR = resolve(REPO_ROOT, `data/aw/_cells-s${SEASON}`);

// ── Image layout constants ──────────────────────────────────────────────
// Pixel-sampled from the guide's headers: defenders column runs from
// x=500 to x=885 (dark-red header colour rgb(106,6,0)); attackers takes
// over at x=890 (dark-green header rgb(0,92,0)).
const DEFENDERS_X_FRAC = 500 / 1280;
const DEFENDERS_W_FRAC = 385 / 1280;
const HEADER_H_PX = 115;

// ── Section → image mapping (DOM order in the saved HTML) ──────────────
const PATH_IMAGES: Record<number, string> = {
  1: 'unnamed(3).png',
  2: 'unnamed(6).png',
  3: 'unnamed(9).png',
  4: 'unnamed(11).png',
  5: 'unnamed(15).png',
  6: 'unnamed(18).png',
  7: 'unnamed(21).png',
  8: 'unnamed(24).png',
  9: 'unnamed(28).png',
};
const SUBS_IMAGES: Record<string, string> = {
  's1': 'unnamed(33).png',
  's2': 'unnamed(36).png',
  's3': 'unnamed(40).png',
};
const BOSS_IMAGE = 'unnamed(44).png';
// SUBS-image → node numbers. The map's numbering (37-45 left→right)
// doesn't match GuiaMTC's SUBS Section 1/2/3 labels, so this is an
// empirical mapping — reviewer confirms.
const SUBS_NODES: Record<string, [number, number, number]> = {
  's1': [40, 41, 42], // left column
  's2': [43, 44, 45], // centre column
  's3': [37, 38, 39], // right column
};

// ── phash helpers ───────────────────────────────────────────────────────

type Match = { championId: string; distance: number };

function findMatches(hash: string, cache: Record<string, string>, topN = 3): Match[] {
  const results: Match[] = [];
  for (const [id, h] of Object.entries(cache)) {
    results.push({ championId: id, distance: hammingHex(hash, h) });
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, topN);
}

// ── Cell extraction ────────────────────────────────────────────────────

/** Crop the 8 defender cells for one row of a table image. Returns
 *  buffers in reading order (top-left → top-right → bottom-left → …). */
async function extractRowCells(imgPath: string, rows: number, rowIdx: number): Promise<Buffer[]> {
  const meta = await sharp(imgPath).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const rowH = Math.floor((H - HEADER_H_PX) / rows);
  const dx = Math.round(W * DEFENDERS_X_FRAC);
  const dw = Math.round(W * DEFENDERS_W_FRAC);
  const dy = HEADER_H_PX + rowIdx * rowH;
  const height = Math.min(rowH, H - dy);
  const cellW = Math.floor(dw / 4);
  const cellH = Math.floor(height / 2);
  const cells: Buffer[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const cx = dx + c * cellW;
      const cy = dy + r * cellH;
      const buf = await sharp(imgPath)
        .extract({ left: cx, top: cy, width: cellW, height: cellH })
        .png()
        .toBuffer();
      cells.push(buf);
    }
  }
  return cells;
}

// ── Main pipeline ───────────────────────────────────────────────────────

type NodeExtraction = {
  node: number;
  buffs: string[];
  guideDefenders: string[];
  reviewFlags: string[];
  candidates: Array<{ slot: number; top: Match[] }>;
};

function readExistingBuffs(): Record<number, string[]> {
  if (!existsSync(SEASON_FILE)) return {};
  try {
    const s = JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as {
      nodes: Array<{ node: number; buffs: string[] }>;
    };
    const out: Record<number, string[]> = {};
    for (const n of s.nodes) out[n.node] = n.buffs;
    return out;
  } catch {
    return {};
  }
}

/** Match one row of cells and produce a node extraction. Cells that
 *  land beyond CONFIDENCE_MISS are flagged and their crop is saved for
 *  reviewer inspection. */
// dHash 256-bit thresholds — calibrated against known-correct matches
// on the Season 69 data. A same-character match often lands at 40-90
// because the guide's cell shading (yellow/pink row background)
// differs from the class-tinted background on the Fandom portrait, so
// the hash never gets close to zero even for identical characters.
// The confidence signal is: a big gap between top-1 and top-2 candidates.
// Anything with a small gap or distance > 105 gets flagged.
const CONFIDENCE_OK = 80;
const CONFIDENCE_MISS = 110;
const MIN_GAP_TO_SECOND = 15;
async function matchRow(
  node: number,
  imgPath: string,
  rows: number,
  rowIdx: number,
  cache: Record<string, string>,
  existingBuffs: Record<number, string[]>,
): Promise<NodeExtraction> {
  const cells = await extractRowCells(imgPath, rows, rowIdx);
  const guideDefenders: string[] = [];
  const reviewFlags: string[] = [];
  const candidates: Array<{ slot: number; top: Match[] }> = [];
  for (let slot = 0; slot < cells.length; slot++) {
    const cellBuf = cells[slot]!;
    const hash = await centerCropDHash(cellBuf);
    const top = findMatches(hash, cache, 3);
    candidates.push({ slot: slot + 1, top });
    const best = top[0];
    if (!best) {
      reviewFlags.push(`slot ${slot + 1}: no match candidates (empty cache?)`);
      continue;
    }
    const secondDist = top[1]?.distance ?? 999;
    const gap = secondDist - best.distance;
    const strong = best.distance <= CONFIDENCE_OK && gap >= MIN_GAP_TO_SECOND;
    guideDefenders.push(best.championId);
    // Save every cell — the matcher's precision on this dataset is ~60%
    // so a full-cell dump is the fastest review path (open the sheet
    // for the node, eyeball, fix wrong entries in season-<N>.json).
    mkdirSync(CELLS_DIR, { recursive: true });
    const cellPath = resolve(
      CELLS_DIR,
      `node-${String(node).padStart(2, '0')}-slot-${slot + 1}.png`,
    );
    writeFileSync(cellPath, cellBuf);
    if (!strong) {
      const alt = top
        .slice(1)
        .map((m) => `${m.championId}(d=${m.distance})`)
        .join(', ');
      reviewFlags.push(
        `slot ${slot + 1}: ${best.championId} (d=${best.distance}, gap ${gap}); alts: ${alt}`,
      );
    }
  }
  return {
    node,
    buffs: existingBuffs[node] ?? [],
    guideDefenders,
    reviewFlags,
    candidates,
  };
}

async function main(): Promise<void> {
  if (!existsSync(DUMP)) {
    console.error(`Dump dir not found: ${DUMP}`);
    process.exit(1);
  }
  if (!existsSync(HASH_CACHE_PATH)) {
    console.error(
      `Portrait hash cache not found. Run: tsx scripts/build-portrait-hash-cache.ts`,
    );
    process.exit(1);
  }
  const cache = (JSON.parse(readFileSync(HASH_CACHE_PATH, 'utf-8')) as {
    hashes: Record<string, string>;
  }).hashes;
  console.log(`portrait cache: ${Object.keys(cache).length} champions`);

  const existingBuffs = readExistingBuffs();
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as {
    champions: Array<{ id: string; name: string }>;
  };
  const nameById = new Map(seed.champions.map((c) => [c.id, c.name]));

  const extractions: NodeExtraction[] = [];

  console.log('\n── Paths ──────');
  for (const [pathNumStr, filename] of Object.entries(PATH_IMAGES)) {
    const pathNum = Number(pathNumStr);
    const imgPath = resolve(DUMP, filename);
    if (!existsSync(imgPath)) {
      console.warn(`  path ${pathNum}: ${filename} not found`);
      continue;
    }
    for (let r = 0; r < 4; r++) {
      const node = pathNum + 9 * r;
      const ext = await matchRow(node, imgPath, 4, r, cache, existingBuffs);
      extractions.push(ext);
      const names = ext.guideDefenders.map((id) => nameById.get(id) ?? id).join(', ');
      const flag = ext.reviewFlags.length > 0 ? ` ⚠ ${ext.reviewFlags.length}` : '';
      console.log(`  node ${String(node).padStart(2)}: ${names}${flag}`);
    }
  }

  console.log('\n── SUBS ──────');
  for (const [key, filename] of Object.entries(SUBS_IMAGES)) {
    const imgPath = resolve(DUMP, filename);
    if (!existsSync(imgPath)) {
      console.warn(`  ${key}: ${filename} not found`);
      continue;
    }
    const nodes = SUBS_NODES[key]!;
    for (let r = 0; r < 3; r++) {
      const node = nodes[r]!;
      const ext = await matchRow(node, imgPath, 3, r, cache, existingBuffs);
      extractions.push(ext);
      const names = ext.guideDefenders.map((id) => nameById.get(id) ?? id).join(', ');
      const flag = ext.reviewFlags.length > 0 ? ` ⚠ ${ext.reviewFlags.length}` : '';
      console.log(`  node ${String(node).padStart(2)}: ${names}${flag}`);
    }
  }

  console.log('\n── Boss Island ──────');
  const bossPath = resolve(DUMP, BOSS_IMAGE);
  if (existsSync(bossPath)) {
    for (let r = 0; r < 5; r++) {
      const node = 46 + r;
      const ext = await matchRow(node, bossPath, 5, r, cache, existingBuffs);
      extractions.push(ext);
      const names = ext.guideDefenders.map((id) => nameById.get(id) ?? id).join(', ');
      const flag = ext.reviewFlags.length > 0 ? ` ⚠ ${ext.reviewFlags.length}` : '';
      console.log(`  node ${String(node).padStart(2)}: ${names}${flag}`);
    }
  }

  extractions.sort((a, b) => a.node - b.node);
  const totalFlags = extractions.reduce((n, e) => n + e.reviewFlags.length, 0);
  console.log(
    `\nExtracted ${extractions.length} nodes; ${totalFlags} cells need review.`,
  );

  if (!APPLY) {
    console.log('\n(dry run — pass --apply to write files)');
    return;
  }
  // Write season file (preserve defaultKeyNodes if present, else default)
  const existing = existsSync(SEASON_FILE)
    ? (JSON.parse(readFileSync(SEASON_FILE, 'utf-8')) as {
        defaultKeyNodes?: number[];
      })
    : {};
  const seasonOut = {
    season: SEASON,
    source: {
      name: 'guiamtc.com',
      url: `https://www.guiamtc.com/aw-season-${SEASON}`,
      capturedAt: new Date().toISOString().slice(0, 10),
    },
    nodes: extractions.map((e) => ({
      node: e.node,
      buffs: e.buffs,
      guideDefenders: e.guideDefenders,
      ...(e.reviewFlags.length > 0 ? { reviewFlags: e.reviewFlags } : {}),
    })),
    defaultKeyNodes: existing.defaultKeyNodes ?? [48, 49, 50],
  };
  mkdirSync(dirname(SEASON_FILE), { recursive: true });
  writeFileSync(SEASON_FILE, JSON.stringify(seasonOut, null, 2) + '\n');
  console.log(`wrote ${SEASON_FILE}`);

  // Review queue
  const reviewLines: string[] = [
    `# Season ${SEASON} extraction review queue`,
    '',
    `Source: https://www.guiamtc.com/aw-season-${SEASON}`,
    `Captured: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${extractions.filter((e) => e.reviewFlags.length > 0).length} nodes flagged (${totalFlags} cells).`,
    '',
    'Crop images for weak matches are under `data/aw/_cells-s' + SEASON + '/`.',
    '',
  ];
  for (const e of extractions) {
    if (e.reviewFlags.length === 0) continue;
    reviewLines.push(`## Node ${e.node}`);
    reviewLines.push('');
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
