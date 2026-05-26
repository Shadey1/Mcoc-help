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
 * Crop + upscale + threshold-invert. Used for the champion name strip:
 * yellow text on dark gradient → black text on white background.
 *
 * Algorithm:
 *   1. Crop & upscale (4x default — name text is small)
 *   2. Sample mean luminance across the crop
 *   3. Pick a threshold slightly above the mean (text is brighter than
 *      background on yellow-on-dark, so mean+offset catches text)
 *   4. Above threshold → black (text). Below → white (background).
 *
 * Adaptive threshold (mean + offset) handles brightness variation across
 * different screenshots better than a fixed threshold would.
 */
function cropAndThresholdInvert(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
  upscale = 4,
  thresholdOffset = 30,
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

  // Compute adaptive threshold from mean luminance (sample every 4th pixel
  // for speed; ~25% of pixels is plenty for a stable mean)
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
    count++;
  }
  const meanLum = sum / count;
  const threshold = meanLum + thresholdOffset;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Above threshold = text (originally bright) → black
    // Below threshold = background (originally dark) → white
    const value = lum > threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    // alpha unchanged
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
 * OCR a region containing a champion name (longer, mixed-case).
 *
 * Two-pass strategy: try PSM_SINGLE_LINE first (most names are one line);
 * if that returns nothing useful, try PSM_SINGLE_WORD as a fallback for
 * cases where Tesseract loses confidence on the line-segmenter.
 *
 * Names sit above the BHR on the card. Threshold-invert preprocessing
 * converts the in-game yellow-on-dark text to black-on-white for Tesseract.
 */
export async function ocrChampionName(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
): Promise<string> {
  const worker = await getWorker();
  const cropped = cropAndThresholdInvert(source, rect, 4, 30);

  debugLogCanvas(cropped, `name crop @ (${Math.round(rect.x)},${Math.round(rect.y)})`);

  // Pass 1: single line
  await worker.setParameters({
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -()0123456789',
    tessedit_pageseg_mode: 7,
  });
  const result1 = await worker.recognize(cropped);
  const text1 = sanitiseNameText(result1.data.text);
  if (looksLikeName(text1)) return text1;

  // Pass 2: single word (helps when line segmenter fails on noisy crops)
  await worker.setParameters({
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -()0123456789',
    tessedit_pageseg_mode: 8,
  });
  const result2 = await worker.recognize(cropped);
  const text2 = sanitiseNameText(result2.data.text);
  // Return whichever has more letters (more likely to be a real name)
  return letterCount(text2) > letterCount(text1) ? text2 : text1;
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
