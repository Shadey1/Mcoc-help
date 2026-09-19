/**
 * Portrait matcher for guide table cells.
 *
 * GuiaMTC pastes the stock champion portrait (same art as our Fandom
 * reference PNGs) onto a flat coloured cell at roughly native cell size.
 * So the match is a template match: slide the reference over the cell,
 * score only where the reference is opaque (its transparent background
 * is whatever colour the guide's cell happens to be), and take the best
 * normalised cross-correlation. A coarse greyscale pass ranks all
 * references; a full-resolution colour pass re-scores the shortlist so
 * recoloured variants separate.
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const COARSE = 4;
const REF_SIZES = [84, 88, 92, 96];
const SHORTLIST = 14;
const ALPHA_MIN = 200;
const MIN_COVERAGE = 0.6;

type Raster = { w: number; h: number; rgb: Uint8Array; grey: Float32Array; alpha: Uint8Array; opaque: number };

export type Ref = { id: string; fine: Map<number, Raster>; coarse: Map<number, Raster> };
export type Match = { championId: string; score: number };

async function raster(input: Buffer | string, w: number, h: number): Promise<Raster> {
  const data = await sharp(input).ensureAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer();
  const n = w * h;
  const rgb = new Uint8Array(n * 3);
  const grey = new Float32Array(n);
  const alpha = new Uint8Array(n);
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    grey[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    alpha[i] = data[i * 4 + 3]!;
    if (alpha[i]! >= ALPHA_MIN) opaque++;
  }
  return { w, h, rgb, grey, alpha, opaque };
}

export async function loadRefs(dir: string): Promise<Ref[]> {
  const refs: Ref[] = [];
  for (const file of readdirSync(dir).filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).sort()) {
    const path = resolve(dir, file);
    const fine = new Map<number, Raster>();
    const coarse = new Map<number, Raster>();
    for (const size of REF_SIZES) {
      fine.set(size, await raster(path, size, size));
      coarse.set(size, await raster(path, size / COARSE, size / COARSE));
    }
    // "<id>~<source>.ext" is a second reference for the same champion.
    refs.push({ id: file.replace(/(~[^.]*)?\.[a-z]+$/i, ''), fine, coarse });
  }
  return refs;
}

function nccGrey(cell: Raster, ref: Raster, ox: number, oy: number): number {
  let n = 0, sc = 0, sr = 0, scc = 0, srr = 0, scr = 0;
  const y0 = Math.max(0, oy);
  const y1 = Math.min(cell.h, oy + ref.h);
  const x0 = Math.max(0, ox);
  const x1 = Math.min(cell.w, ox + ref.w);
  for (let y = y0; y < y1; y++) {
    const rrow = (y - oy) * ref.w - ox;
    const crow = y * cell.w;
    for (let x = x0; x < x1; x++) {
      const ri = rrow + x;
      if (ref.alpha[ri]! < ALPHA_MIN) continue;
      const c = cell.grey[crow + x]!;
      const r = ref.grey[ri]!;
      n++; sc += c; sr += r; scc += c * c; srr += r * r; scr += c * r;
    }
  }
  if (n < ref.opaque * MIN_COVERAGE) return -1;
  const den = (scc - (sc * sc) / n) * (srr - (sr * sr) / n);
  return den <= 0 ? -1 : (scr - (sc * sr) / n) / Math.sqrt(den);
}

function nccColour(cell: Raster, ref: Raster, ox: number, oy: number): number {
  let n = 0;
  const sc = [0, 0, 0], sr = [0, 0, 0];
  let scc = 0, srr = 0, scr = 0;
  const y0 = Math.max(0, oy);
  const y1 = Math.min(cell.h, oy + ref.h);
  const x0 = Math.max(0, ox);
  const x1 = Math.min(cell.w, ox + ref.w);
  for (let y = y0; y < y1; y++) {
    const rrow = (y - oy) * ref.w - ox;
    const crow = y * cell.w;
    for (let x = x0; x < x1; x++) {
      const ri = rrow + x;
      if (ref.alpha[ri]! < ALPHA_MIN) continue;
      n++;
      const ci3 = (crow + x) * 3;
      const ri3 = ri * 3;
      for (let k = 0; k < 3; k++) {
        const c = cell.rgb[ci3 + k]!;
        const r = ref.rgb[ri3 + k]!;
        sc[k]! += c; sr[k]! += r; scc += c * c; srr += r * r; scr += c * r;
      }
    }
  }
  if (n < ref.opaque * MIN_COVERAGE) return -1;
  // Single mean across channels, so a hue shift lowers the score
  // instead of being normalised away per channel.
  const mc = (sc[0]! + sc[1]! + sc[2]!) / (3 * n);
  const mr = (sr[0]! + sr[1]! + sr[2]!) / (3 * n);
  const N = 3 * n;
  const den = (scc - N * mc * mc) * (srr - N * mr * mr);
  return den <= 0 ? -1 : (scr - N * mc * mr) / Math.sqrt(den);
}

/** Rank every reference against one cell crop. Returns best-first. */
export async function matchCell(cellPng: Buffer, refs: Ref[], topN = 3): Promise<Match[]> {
  const meta = await sharp(cellPng).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const fine = await raster(cellPng, W, H);
  const coarse = await raster(cellPng, Math.round(W / COARSE), Math.round(H / COARSE));

  const ranked: Array<{ ref: Ref; score: number; size: number; ox: number; oy: number }> = [];
  for (const ref of refs) {
    let best = { score: -1, size: REF_SIZES[0]!, ox: 0, oy: 0 };
    for (const size of REF_SIZES) {
      const r = ref.coarse.get(size)!;
      const maxOx = coarse.w - r.w + 1;
      const maxOy = coarse.h - r.h + 1;
      for (let oy = -1; oy <= maxOy; oy++) {
        for (let ox = -1; ox <= maxOx; ox++) {
          const s = nccGrey(coarse, r, ox, oy);
          if (s > best.score) best = { score: s, size, ox, oy };
        }
      }
    }
    ranked.push({ ref, ...best });
  }
  ranked.sort((a, b) => b.score - a.score);

  const out: Match[] = [];
  for (const cand of ranked.slice(0, SHORTLIST)) {
    let best = -1;
    for (const size of REF_SIZES) {
      if (Math.abs(size - cand.size) > 4) continue;
      const r = cand.ref.fine.get(size)!;
      const cx = cand.ox * COARSE;
      const cy = cand.oy * COARSE;
      for (let oy = cy - 4; oy <= cy + 4; oy++) {
        for (let ox = cx - 4; ox <= cx + 4; ox++) {
          const s = nccColour(fine, r, ox, oy);
          if (s > best) best = s;
        }
      }
    }
    out.push({ championId: cand.ref.id, score: best });
  }
  out.sort((a, b) => b.score - a.score);
  // Best score per champion: two references for one champion must not
  // look like a close runner-up.
  const seen = new Set<string>();
  return out.filter((m) => !seen.has(m.championId) && seen.add(m.championId)).slice(0, topN);
}
