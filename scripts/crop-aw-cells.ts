/**
 * Crop the defender cells out of a GuiaMTC AW season image into per-node
 * "sheets" that are easy for a human (or a portrait matcher) to identify.
 *
 * The GuiaMTC picks tables have this layout at 1280px wide:
 *   Title bar          (~65px tall, top)
 *   Column headers     (~50px tall)  — Node | Defenders | Attackers
 *   N data rows        (each ~199px tall for paths, similar for SUBS/Boss)
 *     Left: node number cell (green, ~140px wide)
 *     Middle: buff text cell (~300px wide)
 *     Right-middle: 4×2 grid of defender portraits (~380px wide, ~200px tall)
 *     Far right: 4×2 grid of attacker portraits (ignored)
 *
 * We crop the defenders block for each row, then stitch the 2-row cell
 * strip into a single 8-wide sheet so a reviewer can look at 8 champions
 * side-by-side. Sheets go to data/aw/_review-s69/node-<n>.png.
 *
 * Usage: tsx scripts/crop-aw-cells.ts
 */

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DUMP = resolve('dump/MTC Guide - AW - Season 69_files');
const OUT = resolve('data/aw/_review-s69');

// Path N image index in the dump (unnamed(N).png). Maps path 1..9 to
// the DOM-order index we extracted from the saved HTML.
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
// SUBS images cover nodes 37..45. Which SUBS image maps to which node
// range is one of the handover-flagged traps — needs image inspection.
// Best guess: SUBS 1 = nodes 40-42 (left col), SUBS 2 = 43-45 (centre),
// SUBS 3 = 37-39 (right). Confirmed by eyeballing after the first crop.
const SUBS_IMAGES: Record<string, string> = {
  'subs-1': 'unnamed(33).png',
  'subs-2': 'unnamed(36).png',
  'subs-3': 'unnamed(40).png',
};
const BOSS_IMAGE = 'unnamed(44).png';

// Cell geometry — measured from the 1280-wide Path 1 image. Header
// (title + column header) is a fixed pixel height across all images;
// the defender-column x/width are consistent fractions.
const DEFENDERS_X_FRAC = 470 / 1280;
const DEFENDERS_W_FRAC = 410 / 1280;
const HEADER_H_PX = 115;

/** Per-image tile: extract the defenders sub-strip for row `r` (0-based)
 *  out of a source image with `rows` data rows. */
async function extractDefenderStrip(
  imgPath: string,
  rows: number,
  rowIdx: number,
): Promise<Buffer> {
  const meta = await sharp(imgPath).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const rowH = Math.floor((H - HEADER_H_PX) / rows);
  const dx = Math.round(W * DEFENDERS_X_FRAC);
  const dw = Math.round(W * DEFENDERS_W_FRAC);
  const dy = HEADER_H_PX + rowIdx * rowH;
  // Clamp to image bounds — the last row of an odd-tall image can round
  // to dy+rowH one pixel past the image edge.
  const height = Math.min(rowH, H - dy);
  return sharp(imgPath)
    .extract({ left: dx, top: dy, width: dw, height })
    .resize({ width: 800 }) // upscale so each portrait is ~200px wide in the sheet
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  // Path images: 4 rows each, mapping row R (0..3) to node = path + 9*R
  for (const [pathNumStr, filename] of Object.entries(PATH_IMAGES)) {
    const pathNum = Number(pathNumStr);
    const imgPath = resolve(DUMP, filename);
    if (!existsSync(imgPath)) {
      console.warn(`  skip path ${pathNum}: ${filename} not found`);
      continue;
    }
    for (let r = 0; r < 4; r++) {
      const node = pathNum + 9 * r;
      const out = resolve(OUT, `node-${String(node).padStart(2, '0')}.png`);
      const strip = await extractDefenderStrip(imgPath, 4, r);
      await sharp(strip).toFile(out);
      console.log(`  wrote node ${node}`);
    }
  }

  // SUBS images: 3 rows each. Node mapping is a known trap — we crop and
  // label by image + row for now; the human/matcher confirms which map
  // node they correspond to on inspection.
  for (const [label, filename] of Object.entries(SUBS_IMAGES)) {
    const imgPath = resolve(DUMP, filename);
    if (!existsSync(imgPath)) {
      console.warn(`  skip ${label}: ${filename} not found`);
      continue;
    }
    for (let r = 0; r < 3; r++) {
      const out = resolve(OUT, `${label}-row-${r + 1}.png`);
      const strip = await extractDefenderStrip(imgPath, 3, r);
      await sharp(strip).toFile(out);
      console.log(`  wrote ${label} row ${r + 1}`);
    }
  }

  // Boss island: 5 rows for nodes 46..50.
  const bossPath = resolve(DUMP, BOSS_IMAGE);
  if (existsSync(bossPath)) {
    for (let r = 0; r < 5; r++) {
      const node = 46 + r;
      const out = resolve(OUT, `node-${node}.png`);
      const strip = await extractDefenderStrip(bossPath, 5, r);
      await sharp(strip).toFile(out);
      console.log(`  wrote node ${node}`);
    }
  }

  console.log(`\nDone. Sheets in ${OUT}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
