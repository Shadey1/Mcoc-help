/**
 * Tesseract.js wrapper for OCR-ing regions of a canvas.
 *
 * v0.14.0: state-text OCR removed (no state text exists on the prestige page
 * or My Champions page). Replaced with focused BHR OCR — given a known card
 * rectangle, crop the BHR cell and read a single NN,NNN number.
 *
 * Per-card BHR OCR is independent of the whole-image anchor pass: anchors
 * lock the grid; per-card OCRs are the canonical readings used for
 * reverse-derivation. The whole-image pass typically misses 30-50% of BHRs
 * due to scale; the per-card pass with focused crop catches them all.
 *
 * The library is heavy (~2MB minified, plus a language model fetched at
 * runtime from the CDN), so we lazy-load it. A single worker is reused across
 * the import flow.
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

/**
 * Crop a canvas region to a new offscreen canvas for OCR input. Upscales by
 * the given factor — small game text reads more reliably when larger.
 */
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
 * Allows wider character set; expects sparse single-line text.
 *
 * Names sit above the BHR on the card. Useful for cross-validation against
 * the portrait hash match in champion-match.ts.
 */
export async function ocrChampionName(
  source: HTMLCanvasElement | OffscreenCanvas,
  rect: Rect,
): Promise<string> {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_char_whitelist:
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -()0123456789',
    tessedit_pageseg_mode: 7,
  });
  const cropped = cropAndPrepare(source, rect, 2);
  const result = await worker.recognize(cropped);
  return result.data.text.trim();
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
