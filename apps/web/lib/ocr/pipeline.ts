/**
 * OCR pipeline orchestrator — v0.14.0 BHR-anchor approach.
 *
 * Per screenshot:
 *   1. Whole-image OCR pass → BHR anchors (bhr-anchor.ts)
 *   2. Variance row detection + anchor-driven column synthesis → grid cells
 *      (grid-detect.ts)
 *   3. Per cell:
 *        a. Hash portrait region (phash.ts)
 *        b. Focused-OCR the BHR cell (tesseract.ts → ocrBHR)
 *        c. Detect ascension visually (ascension-detect.ts)
 *        d. OCR champion name for cross-validation (tesseract.ts → ocrChampionName)
 *        e. Match champion (champion-match.ts) — portrait + name combined
 *        f. Reverse-derive (rank, sig) from (BHR + champion + ascension)
 *           (bhr-reverse.ts)
 *
 * Returns IdentifiedCards deduplicated by champion across multiple screenshots.
 *
 * Progress events are themed for the Variant D visual direction (see
 * architecture-v5.md §10) — comic-book vocabulary for the moments of impact,
 * editorial restraint everywhere else.
 */

import type { Champion } from '@prestige-tools/engine';
import type { IdentifiedCard, PortraitHashTable, Rect } from './types';
import { detectGridCells } from './grid-detect';
import { findBHRAnchors } from './bhr-anchor';
import { hashImageRegion } from './phash';
import { ocrBHR, ocrChampionName } from './tesseract';
import { detectAscension } from './ascension-detect';
import { deriveStateFromBHR } from './bhr-reverse';
import { matchChampion } from './champion-match';

// ─── Card subregion geometry ────────────────────────────────────────────────
//
// Each card has the same proportional layout: portrait on top, name strip,
// BHR strip, ascension badge bottom-right. These fractions are calibrated
// against the Windows prestige modal and verified against phone screenshots.

const PORTRAIT_REGION = { y: 0.0, h: 0.65 }; // top 65%
const NAME_REGION = { y: 0.65, h: 0.16 }; // 65-81% — name strip
const BHR_REGION = { y: 0.78, h: 0.18 }; // 78-96% — BHR number (slight overlap with name OK)

// ─── Progress events ────────────────────────────────────────────────────────

export type ProgressUpdate =
  | { kind: 'screenshot-start'; index: number; total: number; copy: string }
  | { kind: 'anchors-found'; index: number; count: number; copy: string }
  | { kind: 'grid-detected'; index: number; cellCount: number; copy: string }
  | {
      kind: 'card-processed';
      screenshotIndex: number;
      cardIndex: number;
      totalCards: number;
      copy: string;
    }
  | { kind: 'screenshot-failed'; index: number; reason: string; copy: string }
  | { kind: 'screenshot-done'; index: number; copy: string };

export type PipelineOptions = {
  champions: Champion[];
  portraitLibrary: PortraitHashTable;
  onProgress?: (update: ProgressUpdate) => void;
};

// ─── Themed progress copy (Variant D — multiverse vocabulary) ───────────────

const COPY = {
  screenshotStart: (i: number, total: number) =>
    `Entering screenshot ${i + 1} of ${total}…`,
  anchorScan: 'Searching the multiverse for BHR markers…',
  gridLock: (n: number) => `Multiverse mapped — ${n} cells in formation.`,
  cardProcessing: (i: number, total: number) =>
    `Identifying champion ${i + 1} of ${total}…`,
  done: (i: number) => `Screenshot ${i + 1} sealed.`,
  failed: (reason: string) => `Reality skipped: ${reason}`,
};

// ─── Public entry ───────────────────────────────────────────────────────────

export async function runOcrPipeline(
  files: File[] | Blob[],
  options: PipelineOptions,
): Promise<IdentifiedCard[]> {
  const allCards: IdentifiedCard[] = [];

  for (let i = 0; i < files.length; i++) {
    options.onProgress?.({
      kind: 'screenshot-start',
      index: i,
      total: files.length,
      copy: COPY.screenshotStart(i, files.length),
    });
    try {
      const cards = await processSingleScreenshot(files[i]!, i, options);
      allCards.push(...cards);
      options.onProgress?.({
        kind: 'screenshot-done',
        index: i,
        copy: COPY.done(i),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      options.onProgress?.({
        kind: 'screenshot-failed',
        index: i,
        reason,
        copy: COPY.failed(reason),
      });
    }
  }

  return dedupeByChampion(allCards);
}

// ─── Per-screenshot processing ──────────────────────────────────────────────

async function processSingleScreenshot(
  file: File | Blob,
  sourceIndex: number,
  options: PipelineOptions,
): Promise<IdentifiedCard[]> {
  const canvas = await loadToCanvas(file);

  // Stage 1: BHR anchor pass (whole-image OCR)
  options.onProgress?.({
    kind: 'anchors-found',
    index: sourceIndex,
    count: 0,
    copy: COPY.anchorScan,
  });
  const anchors = await findBHRAnchors(canvas);

  // Stage 2: grid synthesis (variance rows + anchor columns)
  const detected = detectGridCells(canvas, anchors, sourceIndex);
  options.onProgress?.({
    kind: 'grid-detected',
    index: sourceIndex,
    cellCount: detected.length,
    copy: COPY.gridLock(detected.length),
  });

  if (detected.length === 0) {
    throw new Error(
      'No champion cards detected. Make sure the screenshot is from the in-game prestige page or My Champions tab.',
    );
  }

  // Stage 3: per-card processing
  const results: IdentifiedCard[] = [];
  for (let i = 0; i < detected.length; i++) {
    options.onProgress?.({
      kind: 'card-processed',
      screenshotIndex: sourceIndex,
      cardIndex: i,
      totalCards: detected.length,
      copy: COPY.cardProcessing(i, detected.length),
    });
    const card = detected[i]!;
    const result = await processCard(card, canvas, options);
    if (result) results.push(result);
  }
  return results;
}

async function processCard(
  card: { rect: Rect; cardIndex: number; sourceIndex: number },
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: PipelineOptions,
): Promise<IdentifiedCard | null> {
  // Subregion rects
  const portraitRect: Rect = {
    x: card.rect.x,
    y: card.rect.y + card.rect.height * PORTRAIT_REGION.y,
    width: card.rect.width,
    height: card.rect.height * PORTRAIT_REGION.h,
  };
  const nameRect: Rect = {
    x: card.rect.x,
    y: card.rect.y + card.rect.height * NAME_REGION.y,
    width: card.rect.width,
    height: card.rect.height * NAME_REGION.h,
  };
  const bhrRect: Rect = {
    x: card.rect.x,
    y: card.rect.y + card.rect.height * BHR_REGION.y,
    width: card.rect.width,
    height: card.rect.height * BHR_REGION.h,
  };

  // Portrait hash (sync, fast)
  const portraitHash = hashImageRegion(
    canvas,
    portraitRect.x,
    portraitRect.y,
    portraitRect.width,
    portraitRect.height,
  );

  // Ascension via visual pip count (sync, fast)
  const ascension = detectAscension(canvas, card.rect);

  // OCR name and BHR in parallel
  const [nameText, ocredBHR] = await Promise.all([
    ocrChampionName(canvas, nameRect).catch(() => ''),
    ocrBHR(canvas, bhrRect).catch(() => null),
  ]);

  // Identify champion from portrait + name
  const match = matchChampion(
    portraitHash,
    nameText || null,
    options.champions,
    options.portraitLibrary,
  );

  // Reverse-derive state from BHR + champion identity + visual ascension
  let derivedState = null;
  if (ocredBHR !== null && match.championId) {
    const champion = options.champions.find((c) => c.id === match.championId);
    if (champion) {
      derivedState = deriveStateFromBHR(
        champion,
        ocredBHR,
        champion.ascendable ? ascension : 'A0',
      );
    }
  }

  // Skip cards with no champion identification at all
  if (!match.championId) return null;

  return {
    tile: {
      detected: card,
      portraitHash,
      derivedState,
      nameText: nameText || null,
    },
    match,
    userOverrideId: null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadToCanvas(file: File | Blob): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * Deduplicate cards across multiple screenshots — if the same champion appears
 * in two screenshots (e.g. user pasted both prestige modal and My Champions),
 * keep the entry with the highest match confidence. Derived state is taken
 * from that same higher-confidence reading.
 */
function dedupeByChampion(cards: IdentifiedCard[]): IdentifiedCard[] {
  const bestByChampion = new Map<string, IdentifiedCard>();
  for (const card of cards) {
    const existing = bestByChampion.get(card.match.championId);
    if (!existing || card.match.confidence > existing.match.confidence) {
      bestByChampion.set(card.match.championId, card);
    }
  }
  return Array.from(bestByChampion.values());
}
