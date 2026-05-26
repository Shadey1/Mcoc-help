/**
 * OCR pipeline orchestrator (v0.16.0 — BHR-first identification).
 *
 * Per screenshot:
 *   1. Whole-image OCR pass → BHR anchors (bhr-anchor.ts)
 *   2. Variance row detection + anchor-driven column synthesis → grid cells
 *      (grid-detect.ts)
 *   3. Per cell:
 *        a. Hash portrait region (phash.ts)
 *        b. Generate thumbnail of portrait region (portrait-store.ts)
 *        c. Focused-OCR the BHR cell (tesseract.ts → ocrBHR)
 *        d. Detect ascension visually (ascension-detect.ts) — used as a hint only
 *        e. OCR champion name (tesseract.ts → ocrChampionName)
 *        f. Match champion (champion-match.ts) using BHR + portrait + name
 *        g. Derive (rank, sig) state from BHR for the matched champion
 *
 * v0.16.0 change: matchChampion now receives `observedBHR` and `ascensionHint`
 * in addition to the portrait and name signals. BHR-based identification
 * (bhr-identify.ts) is the primary signal — it works on day 1 with no prior
 * data because the engine math is deterministic and BHRs are usually unique
 * to one (champion, state) tuple within tolerance.
 *
 * Order matters: identification happens BEFORE state derivation now, and the
 * state comes either from the BHR-search candidate directly (when champion
 * matched via BHR) or from a focused per-champion reverse-derive.
 */

import type { Champion } from '@prestige-tools/engine';
import type { IdentifiedCard, Rect } from './types';
import type { PortraitStore } from './portrait-store';
import { generateThumbnail } from './portrait-store';
import { detectGridCells } from './grid-detect';
import { findBHRAnchors } from './bhr-anchor';
import { hashImageRegion } from './phash';
import { ocrBHR, ocrChampionName } from './tesseract';
import { detectAscension } from './ascension-detect';
import { deriveStateFromBHR } from './bhr-reverse';
import { matchChampion } from './champion-match';

// ─── Card subregion geometry ──────────────────────────────────────────────

const PORTRAIT_REGION = { y: 0.0, h: 0.65 };
const NAME_REGION = { y: 0.65, h: 0.16 };
const BHR_REGION = { y: 0.78, h: 0.18 };

// ─── Progress events ──────────────────────────────────────────────────────

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
  portraitStore: PortraitStore;
  onProgress?: (update: ProgressUpdate) => void;
};

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

async function processSingleScreenshot(
  file: File | Blob,
  sourceIndex: number,
  options: PipelineOptions,
): Promise<IdentifiedCard[]> {
  const canvas = await loadToCanvas(file);

  options.onProgress?.({
    kind: 'anchors-found',
    index: sourceIndex,
    count: 0,
    copy: COPY.anchorScan,
  });
  const anchors = await findBHRAnchors(canvas);

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

  const portraitHash = hashImageRegion(
    canvas,
    portraitRect.x,
    portraitRect.y,
    portraitRect.width,
    portraitRect.height,
  );

  const thumbnailDataUrl = await generateThumbnail(
    canvas,
    portraitRect.x,
    portraitRect.y,
    portraitRect.width,
    portraitRect.height,
    64,
  );

  // Visual ascension detection — used as a hint to matchChampion only.
  // The current visual detector (bottom-right pip-count) is known unreliable
  // against modern card layouts, so champion-match treats this as a soft
  // preference rather than a hard constraint.
  const visualAscension = detectAscension(canvas, card.rect);

  // OCR name and BHR in parallel
  const [nameText, ocredBHR] = await Promise.all([
    ocrChampionName(canvas, nameRect).catch(() => ''),
    ocrBHR(canvas, bhrRect).catch(() => null),
  ]);

  // Identify champion using all three signals (BHR primary, portrait + name corroborating)
  const match = matchChampion(
    portraitHash,
    nameText || null,
    ocredBHR,
    visualAscension,
    options.champions,
    options.portraitStore,
  );

  // Derive (rank, sig) state from BHR for the matched champion. The
  // BHR-search candidate already implicitly contains a state, but
  // deriveStateFromBHR does the round-sig preference for nicer display
  // (e.g. prefer sig 200 over sig 198 when both fit).
  let derivedState = null;
  if (ocredBHR !== null && match.championId) {
    const champion = options.champions.find((c) => c.id === match.championId);
    if (champion) {
      // Use the matched champion's reachable ascensions to find the best fit.
      // If the visual hint disagrees with the BHR-match's ascension, trust BHR.
      const ascensions: Array<'A0' | 'A1' | 'A2'> = champion.ascendable
        ? ['A2', 'A1', 'A0']
        : ['A0'];
      let best: ReturnType<typeof deriveStateFromBHR> | null = null;
      for (const asc of ascensions) {
        const candidate = deriveStateFromBHR(champion, ocredBHR, asc);
        if (candidate && (!best || candidate.absError < best.absError)) {
          best = candidate;
        }
      }
      derivedState = best;
    }
  }

  if (!match.championId) {
    console.log(
      `[pipeline] card ${card.cardIndex} (screenshot ${card.sourceIndex}): no champion identified`,
      { nameText, ocredBHR, visualAscension, portraitHash },
    );
    return null;
  }

  return {
    tile: {
      detected: card,
      portraitHash,
      thumbnailDataUrl,
      derivedState,
      nameText: nameText || null,
    },
    match,
    userOverrideId: null,
  };
}

async function loadToCanvas(file: File | Blob): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

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
