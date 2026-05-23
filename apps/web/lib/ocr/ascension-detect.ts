/**
 * Visual ascension detection.
 *
 * The ascension badge sits at the bottom-right of each card. It shows:
 *   - A0: no badge / empty pip area
 *   - A1: a small badge with "1" inside (a single chevron)
 *   - A2: a small badge with "2" inside (two chevrons stacked)
 *
 * Reading this from OCR is unreliable — the badge is small, the digits run
 * together with adjacent class icons, and tesseract.js confuses 1/I/l/2/Z in
 * tiny fonts. Visual detection is more robust:
 *
 *   1. Crop the bottom-right corner of the card (where the badge sits).
 *   2. Run a vertical "ink density" scan — count high-saturation pixels per
 *      horizontal strip.
 *   3. The number of distinct dense bands ≈ the pip count.
 *
 * Alternative: read the digit "1" or "2" via focused OCR. We do that as a
 * fallback when visual detection is ambiguous, since for a single digit
 * Tesseract is usually fine.
 *
 * The architecture-doc reference says A0/A1/A2 are the only meaningful values
 * (no A3+ exists in MCOC as of May 2026).
 */

import type { Ascension } from '@prestige-tools/engine';
import type { Rect } from './types';

/**
 * Subregion of a card where the ascension badge lives. Empirically the badge
 * sits in the bottom-right ~18% width × 18% height of the card. We expand
 * slightly to catch the edge.
 */
const BADGE_REGION = { x: 0.78, y: 0.78, w: 0.22, h: 0.22 };

/** Saturation threshold — pixels above this are "ink" (part of the badge). */
const INK_SATURATION = 0.35;

/**
 * Detect ascension level by examining the bottom-right badge region of a card.
 * Returns A0 if no badge visually present, A1 / A2 if pips detected.
 */
export function detectAscension(
  source: HTMLCanvasElement | OffscreenCanvas,
  cardRect: Rect,
): Ascension {
  const bx = cardRect.x + cardRect.width * BADGE_REGION.x;
  const by = cardRect.y + cardRect.height * BADGE_REGION.y;
  const bw = cardRect.width * BADGE_REGION.w;
  const bh = cardRect.height * BADGE_REGION.h;

  // Sample the badge region into a small canvas for analysis
  const sampleW = 48;
  const sampleH = 48;
  const tmp = new OffscreenCanvas(sampleW, sampleH);
  const ctx = tmp.getContext('2d');
  if (!ctx) return 'A0';
  ctx.drawImage(source, bx, by, bw, bh, 0, 0, sampleW, sampleH);
  const rgba = ctx.getImageData(0, 0, sampleW, sampleH).data;

  // Compute per-row saturation density (HSV S channel). Badges are coloured
  // (gold / red); empty card background is dark grey or transparent.
  const rowSat = new Float32Array(sampleH);
  for (let y = 0; y < sampleH; y++) {
    let count = 0;
    for (let x = 0; x < sampleW; x++) {
      const i = (y * sampleW + x) * 4;
      const r = rgba[i]! / 255;
      const g = rgba[i + 1]! / 255;
      const b = rgba[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > INK_SATURATION) count++;
    }
    rowSat[y] = count / sampleW;
  }

  // Count distinct high-density bands (rows of "ink" separated by gaps).
  const HIGH = 0.25;
  const LOW = 0.10;
  let bands = 0;
  let inBand = false;
  let bandLen = 0;
  for (let y = 0; y < sampleH; y++) {
    const v = rowSat[y]!;
    if (!inBand && v >= HIGH) {
      inBand = true;
      bandLen = 1;
    } else if (inBand && v >= LOW) {
      bandLen++;
    } else if (inBand) {
      // band ended
      if (bandLen >= 3) bands++;
      inBand = false;
      bandLen = 0;
    }
  }
  if (inBand && bandLen >= 3) bands++;

  if (bands >= 2) return 'A2';
  if (bands === 1) return 'A1';
  return 'A0';
}
