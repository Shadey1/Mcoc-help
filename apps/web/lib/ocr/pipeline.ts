/**
 * OCR pipeline orchestrator — anchor-relative positioning.
 *
 * v0.17.0 rewrite: card sub-regions (portrait, name, BHR) are now computed
 * relative to the BHR anchor's known bounding box, not fixed percentages
 * of card height. This makes the pipeline device-agnostic — the anchor
 * position adapts to iPhone, Android, and Windows layouts automatically.
 *
 * Pipeline phases:
 *   1. Grid phase: for ALL screenshots, find BHR anchors and detect grid cells.
 *      Each cell carries an optional BHR anchor with pixel-precise coordinates.
 *   2. Dedup phase: match BHR anchor values across screenshots to skip cards
 *      from overlapping regions before expensive per-card OCR.
 *   3. Card phase: per-card OCR using anchor-relative crop positions.
 *   4. Assignment phase: greedy champion assignment to resolve conflicts.
 */

import type { Champion } from '@prestige-tools/engine';
import type { BHRAnchor, DetectedCard, IdentifiedCard, Rect } from './types';
import type { PortraitStore } from './portrait-store';
import { generateThumbnail } from './portrait-store';
import { detectGridCells } from './grid-detect';
import { findBHRAnchors } from './bhr-anchor';
import { hashImageRegion } from './phash';
import { ocrBHR, ocrChampionName } from './tesseract';
import { detectAscension } from './ascension-detect';
import { deriveStateFromBHR } from './bhr-reverse';
import { matchChampion } from './champion-match';

// ─── Anchor-relative region computation ──────────────────────────────────

// Fallback percentages when a card has no BHR anchor
const FALLBACK_PORTRAIT = { y: 0.0, h: 0.62 };
const FALLBACK_NAME = { y: 0.62, h: 0.16 };
const FALLBACK_BHR = { y: 0.78, h: 0.18 };

function computeCardRegions(
  card: DetectedCard,
): { portrait: Rect; name: Rect; bhr: Rect } {
  const { rect, anchor } = card;

  if (!anchor) {
    return {
      portrait: pctRegion(rect, FALLBACK_PORTRAIT),
      name: pctRegion(rect, FALLBACK_NAME),
      bhr: pctRegion(rect, FALLBACK_BHR),
    };
  }

  // Use anchor text height as the unit of measurement — scales with device
  const bhrH = Math.max(anchor.rect.height, 15);

  // BHR region: the anchor rect with padding
  const bhrPadY = bhrH * 0.4;
  const bhrPadX = bhrH * 0.5;
  const bhrRect: Rect = {
    x: Math.max(rect.x, anchor.rect.x - bhrPadX),
    y: Math.max(rect.y, anchor.rect.y - bhrPadY),
    width: Math.min(anchor.rect.width + bhrPadX * 2, rect.width),
    height: anchor.rect.height + bhrPadY * 2,
  };

  // Name region: just above the BHR anchor. Calibrated from Windows
  // screenshots (2026-05-20): BHR text at y=587, name text at y=553-573,
  // star icons between name and BHR. The gap from name bottom to BHR top
  // is ~0.3×bhrH (stars), and name strip is ~0.7×bhrH tall. We add margin
  // to ensure capture across devices.
  const nameGap = bhrH * 0.3;
  const nameHeight = bhrH * 0.7;
  const nameBottom = anchor.rect.y - nameGap;
  const nameTop = Math.max(rect.y, nameBottom - nameHeight);
  const nameRect: Rect = {
    x: rect.x,
    y: nameTop,
    width: rect.width,
    height: Math.max(nameBottom - nameTop, bhrH),
  };

  // Portrait region: top of cell down to where name starts
  const portraitRect: Rect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.max(nameRect.y - rect.y, rect.height * 0.4),
  };

  return { portrait: portraitRect, name: nameRect, bhr: bhrRect };
}

function pctRegion(cell: Rect, pct: { y: number; h: number }): Rect {
  return {
    x: cell.x,
    y: cell.y + cell.height * pct.y,
    width: cell.width,
    height: cell.height * pct.h,
  };
}

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

// ─── Pipeline orchestrator ───────────────────────────────────────────────

type ScreenshotData = {
  sourceIndex: number;
  canvas: OffscreenCanvas;
  detected: DetectedCard[];
};

export async function runOcrPipeline(
  files: File[] | Blob[],
  options: PipelineOptions,
): Promise<IdentifiedCard[]> {
  // Phase 1: Grid detection for all screenshots (fast)
  const screenshots: ScreenshotData[] = [];

  for (let i = 0; i < files.length; i++) {
    options.onProgress?.({
      kind: 'screenshot-start',
      index: i,
      total: files.length,
      copy: COPY.screenshotStart(i, files.length),
    });

    try {
      const canvas = await loadToCanvas(files[i]!);

      options.onProgress?.({
        kind: 'anchors-found',
        index: i,
        count: 0,
        copy: COPY.anchorScan,
      });
      const anchors = await findBHRAnchors(canvas);

      const detected = detectGridCells(canvas, anchors, i);
      options.onProgress?.({
        kind: 'grid-detected',
        index: i,
        cellCount: detected.length,
        copy: COPY.gridLock(detected.length),
      });

      if (detected.length === 0) {
        options.onProgress?.({
          kind: 'screenshot-failed',
          index: i,
          reason: 'No champion cards detected',
          copy: COPY.failed('No champion cards detected'),
        });
        continue;
      }

      screenshots.push({ sourceIndex: i, canvas, detected });
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

  // Phase 2: Early dedup — skip cards whose BHR anchor value already
  // appeared in an earlier screenshot (overlapping region)
  const skipSet = findDuplicateCards(screenshots);
  if (skipSet.size > 0) {
    console.log(
      `[pipeline] skipping ${skipSet.size} duplicate cards from overlapping screenshots`,
    );
  }

  // Phase 3: Per-card OCR on non-duplicate cards
  const allCards: IdentifiedCard[] = [];

  for (const ss of screenshots) {
    const toProcess = ss.detected.filter(
      (c) => !skipSet.has(`${ss.sourceIndex}:${c.cardIndex}`),
    );

    for (let i = 0; i < toProcess.length; i++) {
      options.onProgress?.({
        kind: 'card-processed',
        screenshotIndex: ss.sourceIndex,
        cardIndex: i,
        totalCards: toProcess.length,
        copy: COPY.cardProcessing(i, toProcess.length),
      });

      const result = await processCard(toProcess[i]!, ss.canvas, options);
      allCards.push(result);
    }

    options.onProgress?.({
      kind: 'screenshot-done',
      index: ss.sourceIndex,
      copy: COPY.done(ss.sourceIndex),
    });
  }

  // Phase 4: Resolve champion assignment conflicts
  return greedyAssign(allCards);
}

// ─── Cross-screenshot dedup ──────────────────────────────────────────────

function findDuplicateCards(screenshots: ScreenshotData[]): Set<string> {
  const skipKeys = new Set<string>();
  if (screenshots.length < 2) return skipKeys;

  // Collect all BHR values from earlier screenshots
  const seenBhr = new Map<number, string>(); // value → "srcIdx:cardIdx"

  for (const ss of screenshots) {
    for (const card of ss.detected) {
      if (!card.anchor) continue;
      const val = card.anchor.value;
      const key = `${ss.sourceIndex}:${card.cardIndex}`;

      // Check if a close BHR value was seen in an earlier screenshot
      let isDupe = false;
      for (const [seenVal, seenKey] of seenBhr) {
        if (
          Math.abs(val - seenVal) <= 100 &&
          !seenKey.startsWith(`${ss.sourceIndex}:`)
        ) {
          isDupe = true;
          break;
        }
      }

      if (isDupe) {
        skipKeys.add(key);
      } else {
        seenBhr.set(val, key);
      }
    }
  }

  return skipKeys;
}

// ─── Per-card processing ─────────────────────────────────────────────────

async function processCard(
  card: DetectedCard,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: PipelineOptions,
): Promise<IdentifiedCard> {
  const { portrait: portraitRect, name: nameRect, bhr: bhrRect } =
    computeCardRegions(card);

  if (card.anchor && card.cardIndex < 3) {
    console.log(
      `[pipeline] card ${card.cardIndex} regions:`,
      `anchor=(y:${Math.round(card.anchor.rect.y)}, h:${Math.round(card.anchor.rect.height)})`,
      `name=(y:${Math.round(nameRect.y)}, h:${Math.round(nameRect.height)})`,
      `bhr=(y:${Math.round(bhrRect.y)}, h:${Math.round(bhrRect.height)})`,
      `cell=(y:${Math.round(card.rect.y)}, h:${Math.round(card.rect.height)})`,
    );
  }

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

  const visualAscension = detectAscension(canvas, card.rect);

  // OCR name and BHR in parallel
  const [nameText, focusedBHR] = await Promise.all([
    ocrChampionName(canvas, nameRect).catch(() => ''),
    ocrBHR(canvas, bhrRect).catch(() => null),
  ]);

  // Fall back to anchor BHR value when per-card OCR fails
  const ocredBHR = focusedBHR ?? card.anchor?.value ?? null;

  // Identify champion using all three signals
  const match = matchChampion(
    portraitHash,
    nameText || null,
    ocredBHR,
    visualAscension,
    options.champions,
    options.portraitStore,
  );

  // Derive (rank, sig) state from BHR for the matched champion
  let derivedState = null;
  if (ocredBHR !== null && match.championId) {
    const champion = options.champions.find((c) => c.id === match.championId);
    if (champion) {
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

// ─── Utilities ───────────────────────────────────────────────────────────

async function loadToCanvas(file: File | Blob): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

// ─── Champion assignment ─────────────────────────────────────────────────

function greedyAssign(cards: IdentifiedCard[]): IdentifiedCard[] {
  const sorted = [...cards].sort(
    (a, b) => b.match.confidence - a.match.confidence,
  );
  const claimed = new Set<string>();
  const result: IdentifiedCard[] = [];

  for (const card of sorted) {
    const champId = card.match.championId;

    if (!champId) {
      result.push(card);
      continue;
    }

    if (!claimed.has(champId)) {
      claimed.add(champId);
      result.push(card);
      continue;
    }

    const alt = card.match.alternatives.find(
      (a) => a.championId && !claimed.has(a.championId),
    );
    if (alt) {
      claimed.add(alt.championId);
      result.push({
        ...card,
        match: {
          championId: alt.championId,
          championName: alt.championName,
          confidence: Math.min(alt.score, card.match.confidence * 0.8),
          agreement: 'weak',
          alternatives: card.match.alternatives.filter(
            (a) => a.championId !== alt.championId,
          ),
        },
      });
    }
  }

  return result;
}
