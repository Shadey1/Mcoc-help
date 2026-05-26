/**
 * Grid detection — variance rows + OCR anchors + column extrapolation. v0.14.1.
 *
 * Changes vs v0.14.0:
 *   - Card cell now extends DOWNWARD past the variance band to include the
 *     name + BHR text that sits below each portrait in dark space. v0.14.0
 *     cells were just the variance band (= portrait only), which meant
 *     PORTRAIT_REGION (top 65%) cropped only the top of the portrait — losing
 *     the most distinctive features — and BHR_REGION (bottom 18%) cropped
 *     the bottom of the portrait, not the BHR text. Both broke matching.
 *   - The downward extension is data-driven: median(anchor_y - band_bottom)
 *     across all anchors in the row, plus a small buffer. Anchors locate
 *     the BHR text precisely.
 *   - Diagnostic logging at every stage.
 */

import type { BHRAnchor, DetectedCard, Rect } from './types';

const SAMPLE_WIDTH = 1000;
const COL_SMOOTH_WINDOW = 20;
const ROW_SMOOTH_WINDOW = 10;
const CONTENT_THRESHOLD = 0.05;
const ROW_THRESHOLD = 0.3;
const MIN_ROW_HEIGHT = 30;
const ROW_HEIGHT_REJECT_RATIO = 0.6;
const EXCLUDE_TOP_FRAC = 0.04;
const EXCLUDE_RIGHT_FRAC = 0.04;

/** Buffer (in source-pixel units) added to anchor offset, to capture full BHR text height. */
const BHR_TEXT_BUFFER = 30;

/**
 * Fallback downward extension when a row has no anchors — expressed as a
 * fraction of the variance-band height. Empirically the name+BHR strip is
 * about 35% of the portrait height across both prestige modal and My Champions.
 */
const FALLBACK_EXTENSION_RATIO = 0.35;

export function detectGridCells(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  anchors: BHRAnchor[],
  sourceIndex: number = 0,
): DetectedCard[] {
  console.log(
    `[grid-detect] source ${canvas.width}×${canvas.height}, ${anchors.length} anchors`,
  );

  const grey = downsampleToGreyscale(canvas);
  const contentRegion = detectContentRegion(grey);
  if (!contentRegion) {
    console.log('[grid-detect] no content region detected');
    return [];
  }
  console.log(
    `[grid-detect] content x (source): ${Math.round(contentRegion.start * grey.scale)}–${Math.round(contentRegion.end * grey.scale)}`,
  );

  const rawRows = detectCardRows(grey, contentRegion);
  const rows = filterByMedianHeight(rawRows);
  console.log(
    `[grid-detect] rows: ${rawRows.length} raw, ${rows.length} after median-height filter`,
  );
  rows.forEach((r, i) =>
    console.log(
      `  row ${i}: y=${Math.round(r.start * grey.scale)}–${Math.round(r.end * grey.scale)} (h=${Math.round((r.end - r.start) * grey.scale)})`,
    ),
  );
  if (rows.length === 0) return [];

  const anchorsPerRow = assignAnchorsToRows(anchors, rows, grey.scale);
  anchorsPerRow.forEach((ancs, i) =>
    console.log(
      `  row ${i}: ${ancs.length} anchors ${ancs.map((a) => a.text).join(',')}`,
    ),
  );

  const grid = computeColumns(anchorsPerRow, contentRegion, grey.scale);
  if (!grid) {
    console.log('[grid-detect] column synthesis failed (need ≥2 anchors in one row)');
    return [];
  }
  console.log(
    `[grid-detect] grid: ${grid.columns.length} cols × ${rows.length} rows, pitch=${Math.round(grid.pitch)}`,
  );

  // v0.14.1: extension downward to include name+BHR strip
  const extensions = computeRowExtensions(rows, anchorsPerRow, grey.scale);
  console.log(`[grid-detect] row extensions (source px):`, extensions.map(Math.round));

  const anchorMap = assignAnchorsToCards(anchorsPerRow, grid);

  const cards: DetectedCard[] = [];
  let cardIndex = 0;
  const bandHeight = medianRowHeight(rows) * grey.scale;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]!;
    const ext = extensions[ri]!;
    const cellTop = row.start * grey.scale;
    const cellBottom = row.end * grey.scale + ext;
    const cellHeight = cellBottom - cellTop;
    const rowCenterY = (cellTop + cellBottom) / 2;

    if (ri === 0) {
      console.log(
        `[grid-detect] sample cell (row 0, col 0): band ${bandHeight.toFixed(0)}px → cell ${cellHeight.toFixed(0)}px (extended ${ext.toFixed(0)}px)`,
      );
    }

    for (const colCenterX of grid.columns) {
      cards.push({
        cardIndex: cardIndex,
        sourceIndex,
        rect: {
          x: Math.round(colCenterX - grid.pitch / 2),
          y: Math.round(rowCenterY - cellHeight / 2),
          width: Math.round(grid.pitch),
          height: Math.round(cellHeight),
        },
        anchor: anchorMap.get(cardIndex),
      });
      cardIndex++;
    }
  }

  const anchoredCount = cards.filter((c) => c.anchor).length;
  console.log(
    `[grid-detect] emitted ${cards.length} cards, ${anchoredCount} with BHR anchors`,
  );
  return cards;
}

/**
 * For each row, compute how far DOWNWARD beyond the variance band the cell
 * should extend, in source-pixel units. Uses anchor positions when available;
 * falls back to a fraction of the band height otherwise.
 */
function computeRowExtensions(
  rows: RowBand[],
  anchorsPerRow: BHRAnchor[][],
  scale: number,
): number[] {
  const perRow: number[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const bandBottom = rows[ri]!.end * scale;
    const offsets = anchorsPerRow[ri]!
      .map((a) => a.rect.y + a.rect.height / 2 - bandBottom)
      .filter((d) => d > 0);
    if (offsets.length > 0) {
      perRow.push(median(offsets) + BHR_TEXT_BUFFER);
    } else {
      perRow.push(NaN);
    }
  }
  // Fill NaN slots with median of known extensions, or fallback fraction
  const known = perRow.filter((v) => !Number.isNaN(v));
  const fillValue =
    known.length > 0
      ? median(known)
      : medianRowHeight(rows) * scale * FALLBACK_EXTENSION_RATIO;
  return perRow.map((v) => (Number.isNaN(v) ? fillValue : v));
}

// ─── Sampling / variance primitives ─────────────────────────────────────────

type GreyGrid = {
  data: Float32Array;
  width: number;
  height: number;
  scale: number;
};

function downsampleToGreyscale(
  source: HTMLCanvasElement | OffscreenCanvas,
): GreyGrid {
  const scale = source.width / SAMPLE_WIDTH;
  const width = SAMPLE_WIDTH;
  const height = Math.round(source.height / scale);
  const tmp = new OffscreenCanvas(width, height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    grey[i] =
      0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  }
  return { data: grey, width, height, scale };
}

function uniformFilter1d(arr: Float32Array, size: number): Float32Array {
  if (size < 2) return arr;
  const out = new Float32Array(arr.length);
  const half = Math.floor(size / 2);
  let runningSum = 0;
  for (let i = 0; i < size; i++) {
    runningSum += arr[Math.min(i, arr.length - 1)]!;
  }
  for (let i = 0; i < arr.length; i++) {
    out[i] = runningSum / size;
    const dropIdx = i - half;
    const addIdx = i + (size - half);
    const drop = dropIdx >= 0 ? arr[Math.min(dropIdx, arr.length - 1)]! : arr[0]!;
    const add = addIdx < arr.length ? arr[addIdx]! : arr[arr.length - 1]!;
    runningSum += add - drop;
  }
  return out;
}

function columnVariances(
  grey: GreyGrid,
  yStart: number,
  yEnd: number,
  xStart: number,
  xEnd: number,
): Float32Array {
  const out = new Float32Array(xEnd - xStart);
  const n = yEnd - yStart;
  for (let x = xStart; x < xEnd; x++) {
    let sum = 0;
    let sumSq = 0;
    for (let y = yStart; y < yEnd; y++) {
      const v = grey.data[y * grey.width + x]!;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    out[x - xStart] = sumSq / n - mean * mean;
  }
  return out;
}

function rowVariances(
  grey: GreyGrid,
  yStart: number,
  yEnd: number,
  xStart: number,
  xEnd: number,
): Float32Array {
  const out = new Float32Array(yEnd - yStart);
  const n = xEnd - xStart;
  for (let y = yStart; y < yEnd; y++) {
    let sum = 0;
    let sumSq = 0;
    for (let x = xStart; x < xEnd; x++) {
      const v = grey.data[y * grey.width + x]!;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    out[y - yStart] = sumSq / n - mean * mean;
  }
  return out;
}

function detectContentRegion(grey: GreyGrid): { start: number; end: number } | null {
  const top = Math.floor(grey.height * EXCLUDE_TOP_FRAC);
  const rightLimit = Math.floor(grey.width * (1 - EXCLUDE_RIGHT_FRAC));
  const colVar = columnVariances(grey, top, grey.height, 0, rightLimit);
  const smoothed = uniformFilter1d(colVar, COL_SMOOTH_WINDOW);
  let peak = 0;
  for (let i = 0; i < smoothed.length; i++) if (smoothed[i]! > peak) peak = smoothed[i]!;
  if (peak === 0) return null;
  const threshold = peak * CONTENT_THRESHOLD;
  let start = -1;
  let end = -1;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i]! > threshold) {
      start = i;
      break;
    }
  }
  for (let i = smoothed.length - 1; i >= 0; i--) {
    if (smoothed[i]! > threshold) {
      end = i + 1;
      break;
    }
  }
  if (start === -1 || end === -1 || end - start < 50) return null;
  return { start, end };
}

type RowBand = { start: number; end: number };

function detectCardRows(
  grey: GreyGrid,
  content: { start: number; end: number },
): RowBand[] {
  const top = Math.floor(grey.height * EXCLUDE_TOP_FRAC);
  const rowVar = rowVariances(grey, top, grey.height, content.start, content.end);
  const smoothed = uniformFilter1d(rowVar, ROW_SMOOTH_WINDOW);
  let peak = 0;
  for (let i = 0; i < smoothed.length; i++) if (smoothed[i]! > peak) peak = smoothed[i]!;
  const threshold = peak * ROW_THRESHOLD;
  const rows: RowBand[] = [];
  let i = 0;
  while (i < smoothed.length) {
    if (smoothed[i]! > threshold) {
      const startI = i;
      while (i < smoothed.length && smoothed[i]! > threshold) i++;
      if (i - startI > MIN_ROW_HEIGHT) {
        rows.push({ start: startI + top, end: i + top });
      }
    } else {
      i++;
    }
  }
  return rows;
}

function filterByMedianHeight(rows: RowBand[]): RowBand[] {
  if (rows.length === 0) return rows;
  const heights = rows.map((r) => r.end - r.start);
  const med = median(heights);
  return rows.filter((r) => r.end - r.start >= med * ROW_HEIGHT_REJECT_RATIO);
}

function medianRowHeight(rows: RowBand[]): number {
  return median(rows.map((r) => r.end - r.start));
}

function assignAnchorsToRows(
  anchors: BHRAnchor[],
  rows: RowBand[],
  scale: number,
): BHRAnchor[][] {
  const out: BHRAnchor[][] = rows.map(() => []);
  for (const a of anchors) {
    const cy = a.rect.y + a.rect.height / 2;
    for (let ri = 0; ri < rows.length; ri++) {
      const rowY0 = rows[ri]!.start * scale;
      const rowY1 = rows[ri]!.end * scale;
      const band = rowY1 - rowY0;
      if (cy >= rowY0 - 20 && cy <= rowY1 + band * 0.9) {
        out[ri]!.push(a);
        break;
      }
    }
  }
  return out;
}

type Grid = { columns: number[]; pitch: number };

function computeColumns(
  anchorsPerRow: BHRAnchor[][],
  content: { start: number; end: number },
  scale: number,
): Grid | null {
  let bestRow: BHRAnchor[] = [];
  for (const row of anchorsPerRow) {
    if (row.length > bestRow.length) bestRow = row;
  }
  if (bestRow.length < 2) return null;
  const xsSet = new Set<number>();
  for (const a of bestRow) xsSet.add(Math.round(a.rect.x + a.rect.width / 2));
  const xs = Array.from(xsSet).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) diffs.push(xs[i + 1]! - xs[i]!);
  const pitch = median(diffs);
  if (pitch <= 0) return null;
  const contentX0 = content.start * scale;
  const contentX1 = content.end * scale;
  let startX = xs[0]!;
  while (startX - pitch > contentX0) startX -= pitch;
  const columns: number[] = [];
  let x = startX;
  while (x < contentX1) {
    columns.push(x);
    x += pitch;
  }
  return { columns, pitch };
}

function assignAnchorsToCards(
  anchorsPerRow: BHRAnchor[][],
  grid: Grid,
): Map<number, BHRAnchor> {
  const result = new Map<number, BHRAnchor>();
  const numCols = grid.columns.length;

  for (let ri = 0; ri < anchorsPerRow.length; ri++) {
    for (const anchor of anchorsPerRow[ri]!) {
      const anchorCx = anchor.rect.x + anchor.rect.width / 2;
      let bestCol = -1;
      let bestDist = Infinity;
      for (let ci = 0; ci < numCols; ci++) {
        const dist = Math.abs(anchorCx - grid.columns[ci]!);
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = ci;
        }
      }
      if (bestCol < 0 || bestDist > grid.pitch / 2) continue;
      const idx = ri * numCols + bestCol;
      const existing = result.get(idx);
      if (!existing) {
        result.set(idx, anchor);
      } else {
        const existingDist = Math.abs(
          existing.rect.x + existing.rect.width / 2 - grid.columns[bestCol]!,
        );
        if (bestDist < existingDist) {
          result.set(idx, anchor);
        }
      }
    }
  }
  return result;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export type { Rect };
