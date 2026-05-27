/**
 * Whole-image OCR pass to locate BHR anchors. v0.14.2 diagnostics & forgiveness.
 *
 * Changes vs v0.14.1:
 *   - BHR_PATTERN accepts comma OR period as thousands separator. Tesseract
 *     reads in-game commas as periods inconsistently ("39,819" → "39.819",
 *     but "37,491" survives). One regex covers both.
 *   - OCR_TARGET_WIDTH bumped 1500 → 2200. The card BHR text is small —
 *     at 1500 each card is ~150px wide and the BHR string within it is ~50px.
 *     Bumping to 2200 gives Tesseract 50% more pixels to work with on the
 *     small digits without paying the cost of native resolution.
 *   - Diagnostic: dump every word containing a digit. This tells us
 *     conclusively whether Tesseract is reading the card BHRs at all. If
 *     yes-but-malformed (e.g. "46 120" with a space, or "46420" with an
 *     OCR error) we tighten the regex from there. If no, we know the card
 *     text is below Tesseract's reading threshold at this resolution and
 *     need to switch to per-row OCR at higher zoom.
 */

import type { BHRAnchor } from './types';

// Matches the FIRST plausible BHR in a word. Lazy on the first capture so
// "386904" parses as 38,690 (38 + 690) not 386,904 (386 + 904 → out of range
// for real BHRs in MCOC). Separator is optional because Tesseract drops the
// comma about half the time. No end anchor — trailing characters are usually
// junk from the adjacent class icon or ascension badge ("46,1204" → "46,120").
const BHR_PATTERN = /^(\d{2,3}?)[,.]?(\d{3})/;

// Global pattern for raw-text scan (post-OCR fallback diagnostic)
const BHR_PATTERN_GLOBAL = /\d{2,3}[,.]?\d{3}/g;

const OCR_TARGET_WIDTH = 2200;

export type OcrWord = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type WholeImageOcrResult = {
  anchors: BHRAnchor[];
  words: OcrWord[];
  scale: number;
  rawText: string;
};

export async function findBHRAnchors(
  source: HTMLCanvasElement | OffscreenCanvas,
): Promise<BHRAnchor[]> {
  const result = await findBHRAnchorsAndWords(source);
  return result.anchors;
}

export async function findBHRAnchorsAndWords(
  source: HTMLCanvasElement | OffscreenCanvas,
): Promise<WholeImageOcrResult> {
  const sourceWidth = source.width;
  const scale = sourceWidth > OCR_TARGET_WIDTH ? sourceWidth / OCR_TARGET_WIDTH : 1;
  const ocrWidth = Math.round(sourceWidth / scale);
  const ocrHeight = Math.round(source.height / scale);

  const downsampled = new OffscreenCanvas(ocrWidth, ocrHeight);
  const ctx = downsampled.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, ocrWidth, ocrHeight);

  console.log(
    `[bhr-anchor] OCR input ${ocrWidth}×${ocrHeight} (source ${sourceWidth}×${source.height}, scale ${scale.toFixed(2)})`,
  );

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    let result = await tryRecognize(worker, downsampled, scale, 3);
    if (result.anchors.length === 0) {
      console.log('[bhr-anchor] PSM 3 returned 0 anchors; retrying PSM 6');
      result = await tryRecognize(worker, downsampled, scale, 6);
    }
    if (result.anchors.length === 0) {
      console.log('[bhr-anchor] PSM 6 returned 0 anchors; retrying PSM 11');
      result = await tryRecognize(worker, downsampled, scale, 11);
    }
    console.log(
      `[bhr-anchor] final ${result.anchors.length} anchors:`,
      result.anchors.map((a) => a.text),
    );
    return { anchors: result.anchors, words: result.words, scale, rawText: result.rawText };
  } finally {
    await worker.terminate();
  }
}

async function tryRecognize(
  worker: { recognize: Function; setParameters: Function },
  image: OffscreenCanvas,
  scale: number,
  psm: number,
): Promise<{ anchors: BHRAnchor[]; words: OcrWord[]; rawText: string }> {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
  });
  const result = await worker.recognize(image, {}, { blocks: true });
  const extracted = extractAnchors(result, scale, psm);
  console.log(`[bhr-anchor] PSM ${psm} → ${extracted.anchors.length} anchors`);
  return extracted;
}

function extractAnchors(
  result: unknown,
  scale: number,
  psm: number,
): { anchors: BHRAnchor[]; words: OcrWord[]; rawText: string } {
  const anchors: BHRAnchor[] = [];

  const data = (result as { data?: unknown }).data;
  if (!data) {
    console.log('[bhr-anchor] result.data missing');
    return { anchors, words: [], rawText: '' };
  }

  // Collect every word with a bbox, from either flat or nested structure
  const allWords: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }> = [];

  const flatWords = (data as { words?: unknown[] }).words;
  if (Array.isArray(flatWords)) {
    for (const word of flatWords) {
      const w = word as {
        text?: string;
        bbox?: { x0: number; y0: number; x1: number; y1: number };
      };
      if (w.text && w.bbox) allWords.push({ text: w.text, bbox: w.bbox });
    }
  }

  if (allWords.length === 0) {
    const blocks = (data as { blocks?: unknown[] }).blocks;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const paragraphs = (block as { paragraphs?: unknown[] }).paragraphs ?? [];
        for (const para of paragraphs) {
          const lines = (para as { lines?: unknown[] }).lines ?? [];
          for (const line of lines) {
            const words = (line as { words?: unknown[] }).words ?? [];
            for (const word of words) {
              const w = word as {
                text?: string;
                bbox?: { x0: number; y0: number; x1: number; y1: number };
              };
              if (w.text && w.bbox) allWords.push({ text: w.text, bbox: w.bbox });
            }
          }
        }
      }
    }
  }

  console.log(`[bhr-anchor PSM ${psm}] collected ${allWords.length} words with bboxes`);

  // DIAGNOSTIC: dump every word containing a digit so we can see what Tesseract
  // actually thinks the numbers on screen say.
  const digitWords = allWords.filter((w) => /\d/.test(w.text));
  console.log(
    `[bhr-anchor PSM ${psm}] ${digitWords.length} digit-containing words:`,
    digitWords.map((w) => w.text),
  );

  // Match against the BHR pattern
  for (const w of allWords) {
    const text = w.text.trim();
    const match = text.match(BHR_PATTERN);
    if (!match) continue;
    const value = parseInt(match[1]! + match[2]!, 10);
    // Sanity range: real BHRs sit roughly 20k–55k. Wider bound just to be safe.
    if (value < 20000 || value > 99999) continue;
    anchors.push({
      value,
      text,
      rect: {
        x: w.bbox.x0 * scale,
        y: w.bbox.y0 * scale,
        width: (w.bbox.x1 - w.bbox.x0) * scale,
        height: (w.bbox.y1 - w.bbox.y0) * scale,
      },
    });
  }

  if (anchors.length === 0) {
    // Fallback diagnostic: check whether raw text contains BHR patterns even
    // though no individual word matched. If yes, Tesseract is tokenising
    // numbers in a way we don't expect (e.g. splitting on the comma).
    const text = (data as { text?: string }).text ?? '';
    const rawMatches = text.match(BHR_PATTERN_GLOBAL) ?? [];
    console.log(
      `[bhr-anchor PSM ${psm}] raw text length=${text.length}, ${rawMatches.length} pattern hits in raw text:`,
      rawMatches,
    );
    if (text.length > 0) {
      console.log(`[bhr-anchor PSM ${psm}] full raw text:`, text);
    }
  }

  const rawText = ((data as { text?: string }).text ?? '');
  return { anchors, words: allWords, rawText };
}
