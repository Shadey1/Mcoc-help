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
import { normalize, levenshtein } from './name-match';

export type NameAnchor = {
  championId: string;
  championName: string;
  rect: Rect;
  /** Ascension detected from nearby text (A1/A2), null = A0 or not detected. */
  ascensionHint: 'A0' | 'A1' | 'A2' | null;
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
  rawText?: string,
): NameAnchor[] {
  // Build normalized lookup: normalizedName → champion
  const champByNorm = new Map<string, Champion>();
  // Also index by the base name without parenthetical suffix
  const champByBase = new Map<string, Champion[]>();
  for (const c of champions) {
    const norm = normalize(c.name);
    champByNorm.set(norm, c);
    // Index by the part before any parenthetical
    const baseName = normalize(c.name.split('(')[0]?.trim() ?? c.name);
    if (baseName.length >= 3) {
      const list = champByBase.get(baseName) ?? [];
      list.push(c);
      champByBase.set(baseName, list);
    }
  }

  // MCOC displays variants as a PREFIX ("INFAMOUS IRON MAN") while our data
  // uses a parenthetical SUFFIX ("Iron Man (Infamous)"). Without this, the
  // matcher finds the "IRON MAN" sub-sequence and collapses the variant to the
  // base champion. Register the prefix-order key (descriptor + base) so the
  // full variant matches first (it's a longer word run, tried before "IRON
  // MAN"). Guard against clobbering a real champion's exact name.
  for (const c of champions) {
    const m = c.name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!m) continue;
    const prefixKey = normalize(`${m[2]!.trim()} ${m[1]!.trim()}`);
    if (prefixKey.length >= 4 && !champByNorm.has(prefixKey)) {
      champByNorm.set(prefixKey, c);
    }
  }

  // Game display abbreviations → our champion IDs
  const GAME_ALIASES: Record<string, string> = {
    'bladestellar': 'blade-stellar-forged',
    'starlordstellar': 'star-lord-stellar-forged',
    'daredevilhk': 'daredevil-hells-kitchen',
    'blackwidowcv': 'black-widow-claire-voyant',
    'blackwidowdo': 'black-widow-deadly-origin',
    'wolverinex': 'wolverine-weapon-x',
    'spidermanclassic': 'spider-man-classic',
    'spidermanstealth': 'spider-man-stealth-suit',
    'spidermanstark': 'spider-man-stark-enhanced',
    'spidermanmiles': 'spider-man-miles-morales',
    'spidermanpavitr': 'spider-man-pavitr-prabhakar',
    'spiderman2099': 'spider-man-2099',
    'spidermansupr': 'spider-man-supreme',
    'captainamerica': 'captain-america-infinity-war',
    'scarletwitchclassic': 'scarlet-witch-classic',
    'scarletwitchsigil': 'scarlet-witch-sigil',
    'blackpanthercw': 'black-panther-civil-war',
    'ironmaninf': 'iron-man-infamous',
    'ironmaniw': 'iron-man-infinity-war',
    'hulkimmortal': 'hulk-immortal',
    'kinggroot': 'king-groot-deathless',
    'visiondeathless': 'vision-deathless',
    'guillotinedeathless': 'guillotine-deathless',
    'thanosdeathless': 'thanos-deathless',
    'shehulkdeathless': 'she-hulk-deathless',
    'ultronclassic': 'ultron-classic',
    'cyclopsblue': 'cyclops-blue-team',
  };
  for (const [alias, id] of Object.entries(GAME_ALIASES)) {
    const c = champions.find((ch) => ch.id === id);
    if (c) champByNorm.set(alias, c);
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

        // Try exact match, then base name, then fuzzy
        let champ = champByNorm.get(norm);
        if (!champ && norm.length >= 4) {
          // Try matching just the base name — handles game abbreviations
          const candidates = champByBase.get(norm);
          if (candidates?.length === 1) {
            champ = candidates[0];
          }
        }
        if (!champ && norm.length >= 10) {
          // Fuzzy match — only for longer names (10+ chars) where OCR
          // misspelling is the likely cause. Short names have too many
          // Levenshtein collisions and steal IDs from correct matches.
          let bestDist = 2;
          let fuzzyMatch: Champion | undefined;
          for (const [champNorm, c] of champByNorm) {
            if (!c || foundIds.has(c.id)) continue;
            if (Math.abs(champNorm.length - norm.length) > 2) continue;
            try {
              const dist = levenshtein(norm, champNorm);
              if (dist < bestDist) {
                bestDist = dist;
                fuzzyMatch = c;
              }
            } catch {
              // skip invalid comparisons
            }
          }
          if (fuzzyMatch) champ = fuzzyMatch;
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
            ascensionHint: null,
          });
          start += len - 1;
          break;
        }
      }
    }
  }

  // Fallback: search raw text for champion names not found by word matching.
  // The raw text often contains clear champion names that the word-based
  // matching misses due to tokenization or line grouping issues.
  if (rawText) {
    const upperRaw = rawText.toUpperCase();
    for (const c of champions) {
      if (foundIds.has(c.id)) continue;
      // Try the full name and the base name (before parenthetical)
      const fullUpper = c.name.toUpperCase();
      const baseUpper = c.name.split('(')[0]!.trim().toUpperCase();
      const matched = upperRaw.includes(fullUpper) ||
        (baseUpper.length >= 4 && upperRaw.includes(baseUpper));
      if (matched) {
        foundIds.add(c.id);
        // Raw-text-found champions have no reliable spatial position.
        found.push({
          championId: c.id,
          championName: c.name,
          rect: { x: 0, y: 0, width: 0, height: 0 },
          ascensionHint: null,
        });
      }
    }
  }

  // Attach an ascension hint (A1/A2 badge) to each positioned name. This is
  // a soft signal only — the seeder feeds it to findChampionsByBHR as a
  // preference, never a hard filter. BHR pairing is NOT done here anymore:
  // it's device-dependent (different aspect ratios offset the BHR from the
  // name differently). The seeder identifies champions BHR-first instead.
  const ascWords = extractAscensionWords(words, scale);
  console.log(
    `[name-anchor] ${ascWords.length} ascension markers found in OCR`,
  );
  for (const anchor of found) {
    if (anchor.rect.width === 0) continue; // raw-text-found, no position
    anchor.ascensionHint = findAscensionNear(anchor.rect, ascWords);
  }

  console.log(
    `[name-anchor] found ${found.length} champion names:`,
    found.map((f) => f.championName),
  );

  return found;
}

// ─── Ascension detection from OCR text ───────────────────────────────────

const ASCENSION_PATTERN = /^A([12])$/i;

function extractAscensionWords(
  words: OcrWord[],
  scale: number,
): Array<{ asc: 'A1' | 'A2'; cx: number; cy: number }> {
  const results: Array<{ asc: 'A1' | 'A2'; cx: number; cy: number }> = [];
  for (const w of words) {
    const match = w.text.trim().match(ASCENSION_PATTERN);
    if (!match) continue;
    const asc = `A${match[1]}` as 'A1' | 'A2';
    results.push({
      asc,
      cx: ((w.bbox.x0 + w.bbox.x1) / 2) * scale,
      cy: ((w.bbox.y0 + w.bbox.y1) / 2) * scale,
    });
  }
  return results;
}

function findAscensionNear(
  nameRect: Rect,
  ascWords: Array<{ asc: 'A1' | 'A2'; cx: number; cy: number }>,
): 'A0' | 'A1' | 'A2' | null {
  const nameCx = nameRect.x + nameRect.width / 2;
  const nameBottom = nameRect.y + nameRect.height;

  let best: { asc: 'A1' | 'A2'; dist: number } | null = null;

  for (const aw of ascWords) {
    if (aw.cy < nameRect.y - 50) continue;
    if (aw.cy > nameBottom + 200) continue;
    const xDist = Math.abs(aw.cx - nameCx);
    if (xDist > nameRect.width * 3) continue;

    const dist = Math.abs(aw.cy - nameBottom) + xDist * 0.3;
    if (!best || dist < best.dist) {
      best = { asc: aw.asc, dist };
    }
  }

  return best?.asc ?? null;
}

function groupIntoLines(
  words: OcrWord[],
  yTolerance = 20,
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
