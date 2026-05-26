/**
 * Champion name detection from whole-image OCR.
 *
 * The My Champions page renders champion names in large ALL-CAPS yellow text
 * below each portrait. Tesseract reads these clearly in the whole-image pass
 * — much better than per-card crops. This module matches OCR words against
 * the known champion list and returns positioned "name anchors" that locate
 * each champion in the source image.
 *
 * Used for portrait store seeding: each name anchor tells us where a
 * champion's card is, so we can crop the portrait above it and hash it.
 */

import type { Champion } from '@prestige-tools/engine';
import type { Rect } from './types';
import type { OcrWord } from './bhr-anchor';
import { normalize } from './name-match';

export type NameAnchor = {
  championId: string;
  championName: string;
  rect: Rect;
  /** BHR value found below the name text, if any. */
  bhrValue: number | null;
};

/**
 * Find champion names in whole-image OCR words. Multi-word names
 * (e.g. "MISTY KNIGHT", "BLACK WIDOW") are assembled from adjacent words
 * on the same text line (similar y-position).
 */
export function findNameAnchors(
  words: OcrWord[],
  scale: number,
  champions: Champion[],
): NameAnchor[] {
  // Build normalized lookup: normalizedName → champion
  const champByNorm = new Map<string, Champion>();
  // Also index by the first word (handles "LIZARD" matching "lizard")
  // and by name without parenthetical (handles "BLADE" matching "blade-stellar-forged")
  const champByFirstWord = new Map<string, Champion[]>();
  for (const c of champions) {
    const norm = normalize(c.name);
    champByNorm.set(norm, c);
    const firstWord = normalize(c.name.split(/[\s(]/)[0] ?? '');
    if (firstWord.length >= 4) {
      const list = champByFirstWord.get(firstWord) ?? [];
      list.push(c);
      champByFirstWord.set(firstWord, list);
    }
  }

  // Group words into lines by y-position proximity
  const lines = groupIntoLines(words);

  const found: NameAnchor[] = [];
  const foundIds = new Set<string>();

  for (const line of lines) {
    // Try matching sequences of 1-6 consecutive words against champion names
    // (longest first to prefer full names over partial matches)
    for (let start = 0; start < line.length; start++) {
      for (let len = Math.min(6, line.length - start); len >= 1; len--) {
        const slice = line.slice(start, start + len);
        const combined = slice.map((w) => w.text).join(' ');
        const norm = normalize(combined);

        if (norm.length < 3) continue;

        // Try exact match first, then partial (name without parenthetical)
        let champ = champByNorm.get(norm);
        if (!champ) {
          // Try stripping common OCR artifacts and re-matching
          const cleaned = norm.replace(/[^a-z0-9]/g, '');
          champ = champByNorm.get(cleaned) ?? undefined;
        }
        if (champ && !foundIds.has(champ.id)) {
          foundIds.add(champ.id);
          const bbox = mergeBboxes(slice);
          found.push({
            championId: champ.id,
            championName: champ.name,
            rect: {
              x: bbox.x0 * scale,
              y: bbox.y0 * scale,
              width: (bbox.x1 - bbox.x0) * scale,
              height: (bbox.y1 - bbox.y0) * scale,
            },
            bhrValue: null,
          });
          start += len - 1;
          break;
        }
      }
    }
  }

  // Pair each name with the BHR value below it
  const bhrWords = extractBhrWords(words, scale);
  for (const anchor of found) {
    anchor.bhrValue = findBhrBelow(anchor.rect, bhrWords);
  }

  const withBhr = found.filter((f) => f.bhrValue !== null).length;
  console.log(
    `[name-anchor] found ${found.length} champion names (${withBhr} with BHR):`,
    found.map((f) => `${f.championName}${f.bhrValue ? ` (${f.bhrValue})` : ''}`),
  );

  return found;
}

const BHR_WORD_PATTERN = /^(\d{2,3})[,.]?(\d{3})/;

function extractBhrWords(
  words: OcrWord[],
  scale: number,
): Array<{ value: number; cx: number; cy: number }> {
  const results: Array<{ value: number; cx: number; cy: number }> = [];
  for (const w of words) {
    const match = w.text.trim().match(BHR_WORD_PATTERN);
    if (!match) continue;
    const value = parseInt(match[1]! + match[2]!, 10);
    if (value < 10000 || value > 99999) continue;
    results.push({
      value,
      cx: ((w.bbox.x0 + w.bbox.x1) / 2) * scale,
      cy: ((w.bbox.y0 + w.bbox.y1) / 2) * scale,
    });
  }
  return results;
}

function findBhrBelow(
  nameRect: Rect,
  bhrWords: Array<{ value: number; cx: number; cy: number }>,
): number | null {
  const nameCx = nameRect.x + nameRect.width / 2;
  const nameBottom = nameRect.y + nameRect.height;
  const nameH = nameRect.height;

  let best: { value: number; dist: number } | null = null;

  for (const bhr of bhrWords) {
    // BHR must be below the name and horizontally close
    if (bhr.cy < nameBottom) continue;
    if (bhr.cy > nameBottom + nameH * 8) continue;
    const xDist = Math.abs(bhr.cx - nameCx);
    if (xDist > nameRect.width * 1.5) continue;

    const dist = bhr.cy - nameBottom + xDist * 0.3;
    if (!best || dist < best.dist) {
      best = { value: bhr.value, dist };
    }
  }

  return best?.value ?? null;
}

function groupIntoLines(
  words: OcrWord[],
  yTolerance = 10,
): OcrWord[][] {
  if (words.length === 0) return [];

  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const lines: OcrWord[][] = [];
  let currentLine: OcrWord[] = [sorted[0]!];
  let lineY = sorted[0]!.bbox.y0;

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i]!;
    if (Math.abs(w.bbox.y0 - lineY) <= yTolerance) {
      currentLine.push(w);
    } else {
      // Sort line by x-position before adding
      currentLine.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      lines.push(currentLine);
      currentLine = [w];
      lineY = w.bbox.y0;
    }
  }
  currentLine.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  lines.push(currentLine);

  return lines;
}

function mergeBboxes(
  words: OcrWord[],
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of words) {
    if (w.bbox.x0 < x0) x0 = w.bbox.x0;
    if (w.bbox.y0 < y0) y0 = w.bbox.y0;
    if (w.bbox.x1 > x1) x1 = w.bbox.x1;
    if (w.bbox.y1 > y1) y1 = w.bbox.y1;
  }
  return { x0, y0, x1, y1 };
}
