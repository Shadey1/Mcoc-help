/**
 * Tesseract.js wrapper for OCR-ing regions of a canvas.
 *
 * v0.14.0: state-text OCR removed (no state text exists on the prestige page
 * or My Champions page). Replaced with focused BHR OCR — given a known card
 * rectangle, crop the BHR cell and read a single NN,NNN number.
 *
 * v0.16.0: name OCR gained a threshold-invert preprocessing pass and 4x
 * upscale. The in-game champion-name strip is small yellow text on a dark
 * gradient — low contrast for Tesseract's default training. Converting to
 * binary black-on-white (text → black, background → white) plus higher
 * upscale brings name OCR within Tesseract's comfort zone. BHR OCR keeps
 * the simpler pipeline — white-on-dark digits are already high-contrast.
 *
 * Per-card BHR OCR is independent of the whole-image anchor pass: anchors
 * lock the grid; per-card OCRs are the canonical readings used for
 * reverse-derivation. The whole-image pass typically misses 30-50% of BHRs
 * due to scale; the per-card pass with focused crop catches them all.
 *
 * The library is heavy (~2MB minified, plus a language model fetched at
 * runtime from the CDN), so we lazy-load it. A single worker is reused across
 * the import flow.
 *
 * Debug mode: set `window.__OCR_DEBUG = true` in the console BEFORE running
 * the OCR pipeline. Each name crop is stored on `window.__OCR_DEBUG_CROPS`
 * as a clickable blob URL. After processing, in the console:
 *   __OCR_DEBUG_CROPS[0].open()                  // open crop 0 in new tab
 *   __OCR_DEBUG_CROPS.find(c => c.label.includes('755'))?.open()  // by coord
 */

import type { Rect } from './types';

type TesseractWorker = {
  recognize: (
    image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas | Blob,
    options?: unknown,
  ) => Promise<{ data: { text: string } }>;
  setParameters: (params: Record<string, string | number>) => Promise<void>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    return worker as unknown as TesseractWorker;
  })();
  return workerPromise;
}

/** Plain crop + upscale, no contrast adjustment. Used for BHR cells. */
function cropAndPrepare(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
  upscale = 2,
): OffscreenCanvas {
  const w = Math.round(rect.width * upscale);
  const h = Math.round(rect.height * upscale);
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);
  return out;
}

/**
 * Crop + upscale + yellow-channel isolation. Primary strategy for the
 * champion name strip: gold/yellow text on dark gradient.
 *
 * Why yellow-specific: generic luminance thresholding fails because the
 * dark background dominates the mean, and the offset required varies across
 * screenshots. Yellow isolation targets the text colour directly:
 *   yellowness = min(R, G) - B
 * Gold/yellow text has high R, high G, low B → high yellowness.
 * Dark background has low everything → yellowness near zero or negative.
 * White highlights have high B too → yellowness near zero.
 */
function cropAndIsolateYellow(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
  upscale = 4,
): OffscreenCanvas {
  const w = Math.round(rect.width * upscale);
  const h = Math.round(rect.height * upscale);
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Compute yellowness for each pixel, then adaptive-threshold on yellowness
  const yellowness = new Float32Array(w * h);
  let maxY = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const y = Math.min(r, g) - b;
    const idx = i >> 2;
    yellowness[idx] = y;
    if (y > maxY) maxY = y;
  }

  // Threshold at 30% of the peak yellowness — catches the text while
  // rejecting the dark gradient. If peak yellowness is too low (< 40),
  // the crop probably doesn't contain yellow text; fall through to the
  // luminance fallback in ocrChampionName.
  const threshold = maxY * 0.3;
  const hasYellowText = maxY >= 40;

  for (let i = 0; i < data.length; i += 4) {
    const idx = i >> 2;
    const isText = hasYellowText && yellowness[idx]! > threshold;
    const value = isText ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

/**
 * Crop + upscale + luminance threshold. Fallback for non-yellow text
 * (white text on dark, or when yellow isolation produces nothing).
 */
function cropAndThresholdLuminance(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
  upscale = 4,
): OffscreenCanvas {
  const w = Math.round(rect.width * upscale);
  const h = Math.round(rect.height * upscale);
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Percentile-based threshold: sort luminance values and pick the 75th
  // percentile as the cut. Text pixels are the bright minority; background
  // is the dark majority. This is more robust than mean+offset.
  const lumValues: number[] = [];
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    lumValues.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  lumValues.sort((a, b) => a - b);
  const threshold = lumValues[Math.floor(lumValues.length * 0.75)] ?? 128;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const value = lum > threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(imageData, 0, 0);
  return out;
}

/**
 * Fire-and-forget debug capture of a canvas. Gated on `window.__OCR_DEBUG`.
 *
 * Stores each crop as a clickable blob URL on `window.__OCR_DEBUG_CROPS`.
 * After the OCR run finishes, in the console:
 *   __OCR_DEBUG_CROPS[0].open()                  // open crop 0 in new tab
 *   __OCR_DEBUG_CROPS.forEach(c => console.log(c.label))   // list them
 *   __OCR_DEBUG_CROPS.find(c => c.label.includes('755'))?.open()  // by coord
 */
function debugLogCanvas(canvas: OffscreenCanvas, label: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __OCR_DEBUG?: boolean;
    __OCR_DEBUG_CROPS?: Array<{ label: string; url: string; open: () => void }>;
  };
  if (!w.__OCR_DEBUG) return;
  canvas
    .convertToBlob({ type: 'image/png' })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      if (!w.__OCR_DEBUG_CROPS) w.__OCR_DEBUG_CROPS = [];
      const idx = w.__OCR_DEBUG_CROPS.length;
      const entry = {
        label,
        url,
        open: () => {
          window.open(url, '_blank');
        },
      };
      w.__OCR_DEBUG_CROPS.push(entry);
      console.log(`[ocr-debug ${idx}] ${label}  → __OCR_DEBUG_CROPS[${idx}].open()`);
    })
    .catch(() => {
      // debug-only; never throw
    });
}

const BHR_PATTERN = /(\d{2,3}),?(\d{3})/;

/**
 * OCR a focused crop expected to contain a BHR number (NN,NNN format).
 * Returns the parsed integer value, or null if no plausible match found.
 *
 * Uses PSM_SINGLE_LINE since the crop is a tight rectangle containing one
 * number. Whitelists digits and comma to suppress class-icon noise.
 */
export async function ocrBHR(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
): Promise<number | null> {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789,',
    tessedit_pageseg_mode: 7, // PSM_SINGLE_LINE
  });
  const cropped = cropAndPrepare(source, rect, 3);
  const result = await worker.recognize(cropped);
  const text = result.data.text.trim();
  const match = text.match(BHR_PATTERN);
  if (!match) return null;
  const value = parseInt(match[1]! + match[2]!, 10);
  if (value < 20000 || value > 99999) return null;
  return value;
}

/**
 * OCR a strip directly below a champion name, expected to contain that card's
 * BHR number (a stars / ascension row often sits between the name and the
 * number, so the crop is several lines tall — PSM 6 reads the whole block).
 *
 * Returns the largest in-range NN,NNN value found: the BHR is the dominant
 * number on the card, far bigger than any star count or level. A lower floor
 * than ocrBHR is safe here because the crop is anchored to an already-matched
 * champion name, so there's little junk-number risk — this lets low-rank R3
 * BHRs (which can dip below 20k) come through.
 */
export async function ocrBhrStrip(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
  minValue = 12000,
): Promise<number | null> {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789,',
    tessedit_pageseg_mode: 6, // PSM_SINGLE_BLOCK — strip spans stars + number
  });
  const cropped = cropAndPrepare(source, rect, 3);
  debugLogCanvas(
    cropped,
    `bhr-strip @ (${Math.round(rect.x)},${Math.round(rect.y)})`,
  );
  const result = await worker.recognize(cropped);
  let best: number | null = null;
  for (const m of result.data.text.matchAll(/(\d{2,3}),?(\d{3})/g)) {
    const value = parseInt(m[1]! + m[2]!, 10);
    if (value < minValue || value > 99999) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

/**
 * Read a champion's ascension from the gold badge at the right end of the BHR
 * row (after the class icon): "1" → A1, "2" → A2, absent → A0. The badge is
 * gold, so isolating the gold channel drops the dark bar AND the non-gold class
 * icon, leaving just the digit. We take the rightmost digit because the badge
 * sits to the right of any class-icon noise. Region is proportional to the BHR
 * height so it self-scales across devices.
 */
export async function ocrAscensionBadge(
  source: HTMLCanvasElement | OffscreenCanvas,
  bhrRect: Rect,
): Promise<'A1' | 'A2' | null> {
  const h = bhrRect.height;
  if (h <= 0) return null;
  const cw = source.width;
  const ch = source.height;
  // Badge sits just right of the class icon (~1.1h past the number) and is
  // ~1 number-height wide. Keep the window tight so it doesn't bleed into the
  // next card's portrait on the right.
  const x = Math.min(bhrRect.x + bhrRect.width + h * 1.1, cw - 1);
  const y = Math.max(0, bhrRect.y - h * 0.15);
  const width = Math.min(h * 1.5, cw - x);
  const height = Math.min(h * 1.3, ch - y);
  if (width < 4 || height < 4) return null;

  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist: '12',
    tessedit_pageseg_mode: 7, // PSM_SINGLE_LINE
  });
  const crop = cropAndIsolateYellow(source, { x, y, width, height }, 6);
  debugLogCanvas(
    crop,
    `asc-badge @ (${Math.round(bhrRect.x)},${Math.round(bhrRect.y)})`,
  );
  const result = await worker.recognize(crop);
  const matches = [...result.data.text.matchAll(/[12]/g)];
  const last = matches.length ? matches[matches.length - 1]![0] : null;
  return last === '2' ? 'A2' : last === '1' ? 'A1' : null;
}

/**
 * OCR a region containing a champion name (longer, mixed-case).
 *
 * Multi-strategy approach:
 *   1. Yellow-channel isolation (primary — game renders names in gold/yellow)
 *   2. Luminance threshold (fallback — handles white text or when yellow fails)
 * Each strategy tries PSM_SINGLE_LINE then PSM_SINGLE_WORD. The best result
 * across all attempts (most letters = most likely a real name) wins.
 */
export async function ocrChampionName(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
): Promise<string> {
  const worker = await getWorker();

  // Narrow the horizontal crop to the center 70% — cuts card border noise
  const insetX = rect.width * 0.15;
  const narrowRect: Rect = {
    x: rect.x + insetX,
    y: rect.y,
    width: rect.width - insetX * 2,
    height: rect.height,
  };

  // 6x upscale — name text is ~23px in source, needs more resolution
  const yellowCrop = cropAndIsolateYellow(source, narrowRect, 6);
  const lumCrop = cropAndThresholdLuminance(source, narrowRect, 6);

  debugLogCanvas(yellowCrop, `name-yellow @ (${Math.round(rect.x)},${Math.round(rect.y)})`);
  debugLogCanvas(lumCrop, `name-lum @ (${Math.round(rect.x)},${Math.round(rect.y)})`);

  const NAME_WHITELIST =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -()\'0123456789';

  async function tryOcr(crop: OffscreenCanvas, psm: number): Promise<string> {
    await worker.setParameters({
      tessedit_char_whitelist: NAME_WHITELIST,
      tessedit_pageseg_mode: psm,
    });
    const result = await worker.recognize(crop);
    return sanitiseNameText(result.data.text);
  }

  // Sequential — single shared worker can't safely interleave setParameters
  const candidates = [
    await tryOcr(yellowCrop, 7),
    await tryOcr(yellowCrop, 8),
    await tryOcr(lumCrop, 7),
    await tryOcr(lumCrop, 8),
  ];

  let best = '';
  let bestScore = -1;
  for (const c of candidates) {
    const score = letterCount(c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Strip line breaks, runs of whitespace, and leading/trailing punctuation. */
function sanitiseNameText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z)]+$/, '')
    .trim();
}

function letterCount(s: string): number {
  let n = 0;
  for (const c of s) if (/[A-Za-z]/.test(c)) n++;
  return n;
}

function looksLikeName(s: string): boolean {
  // At least 3 letters and not just digits / single chars
  return letterCount(s) >= 3;
}

/**
 * Clean up the singleton worker. Call when the OCR flow ends or the page
 * unmounts. Safe to call multiple times.
 */
export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } catch {
      // ignore termination errors
    }
    workerPromise = null;
  }
}
