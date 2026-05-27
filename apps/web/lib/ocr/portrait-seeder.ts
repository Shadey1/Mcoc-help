/**
 * Portrait store seeder for My Champions screenshots.
 *
 * Unlike the prestige page pipeline (which uses BHR for identification),
 * this uses the champion NAME text from the whole-image OCR pass. The
 * My Champions page renders names in large ALL-CAPS yellow text that
 * Tesseract reads clearly.
 *
 * Flow:
 *   1. Whole-image OCR → extract champion names with bounding boxes
 *   2. For each name: crop the portrait above it, hash it
 *   3. Save hash → championId to the portrait store
 *
 * No grid detection needed — each name's bbox gives the position directly.
 * No BHR matching needed — identification is by name.
 */

import type { Champion, ChampionState } from '@prestige-tools/engine';
import { findBHRAnchorsAndWords } from './bhr-anchor';
import { findNameAnchors, type NameAnchor } from './name-anchor';
import { hashImageRegion } from './phash';
import { deriveStateFromBHR } from './bhr-reverse';
import {
  addPortrait,
  generateThumbnail,
  loadPortraitStore,
  savePortraitStore,
  type PortraitStore,
} from './portrait-store';

export type SeedProgress =
  | { kind: 'scanning'; screenshot: number; total: number }
  | { kind: 'names-found'; screenshot: number; count: number }
  | { kind: 'seeding'; champion: string; current: number; total: number }
  | { kind: 'done'; seeded: number; total: number };

export type SeedResult = {
  seeded: number;
  champions: string[];
  rosterStates: ChampionState[];
};

export async function seedPortraitStore(
  files: File[] | Blob[],
  champions: Champion[],
  onProgress?: (update: SeedProgress) => void,
): Promise<SeedResult> {
  const allAnchors: Array<{ anchor: NameAnchor; canvas: OffscreenCanvas }> = [];

  // Phase 1: Extract name anchors from all screenshots
  for (let i = 0; i < files.length; i++) {
    onProgress?.({
      kind: 'scanning',
      screenshot: i,
      total: files.length,
    });

    const bitmap = await createImageBitmap(files[i]!);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const { words, scale, rawText } = await findBHRAnchorsAndWords(canvas);
    console.log(
      `[portrait-seeder] screenshot ${i}: ${words.length} words, rawText ${rawText.length} chars`,
      rawText.length > 0 ? rawText.substring(0, 200) : '(empty)',
    );
    const nameAnchors = findNameAnchors(words, scale, champions, rawText);

    onProgress?.({
      kind: 'names-found',
      screenshot: i,
      count: nameAnchors.length,
    });

    for (const anchor of nameAnchors) {
      allAnchors.push({ anchor, canvas });
    }
  }

  // Dedupe by championId (keep first occurrence)
  const seen = new Set<string>();
  const unique = allAnchors.filter(({ anchor }) => {
    if (seen.has(anchor.championId)) return false;
    seen.add(anchor.championId);
    return true;
  });

  const missing = champions
    .filter((c) => !seen.has(c.id))
    .map((c) => c.name);
  console.log(
    `[portrait-seeder] ${unique.length} unique champions found, ${missing.length} missing from data:\n${missing.join(', ')}`,
  );

  // Phase 2: Crop portraits, derive state, save to store
  let store: PortraitStore = loadPortraitStore();
  const seededNames: string[] = [];
  const rosterStates: ChampionState[] = [];
  const champLookup = new Map(champions.map((c) => [c.id, c]));

  for (let i = 0; i < unique.length; i++) {
    const { anchor, canvas } = unique[i]!;

    onProgress?.({
      kind: 'seeding',
      champion: anchor.championName,
      current: i,
      total: unique.length,
    });

    // Portrait region: above the name text
    const nameH = anchor.rect.height;
    const portraitHeight = nameH * 4;
    const portraitY = Math.max(0, anchor.rect.y - portraitHeight);
    const portraitRect = {
      x: anchor.rect.x,
      y: portraitY,
      width: anchor.rect.width,
      height: anchor.rect.y - portraitY,
    };

    const hash = hashImageRegion(
      canvas,
      portraitRect.x,
      portraitRect.y,
      portraitRect.width,
      portraitRect.height,
    );

    const thumbnail = await generateThumbnail(
      canvas,
      portraitRect.x,
      portraitRect.y,
      portraitRect.width,
      portraitRect.height,
      64,
    );

    store = addPortrait(store, anchor.championId, {
      hash,
      capturedAt: new Date().toISOString(),
      thumbnailDataUrl: thumbnail,
    });

    // Derive state from BHR, or use floor defaults
    const champ = champLookup.get(anchor.championId);
    if (champ) {
      if (anchor.bhrValue) {
        const ascensions: Array<'A0' | 'A1' | 'A2'> = anchor.ascensionHint
          ? [anchor.ascensionHint]
          : champ.ascendable
            ? ['A2', 'A1', 'A0']
            : ['A0'];
        // Use wider tolerance for My Champions import — lower BHR values
        // have larger prediction error than the top-30 prestige range
        const SEEDER_TOLERANCE = 500;
        let bestState: ReturnType<typeof deriveStateFromBHR> | null = null;
        for (const asc of ascensions) {
          const candidate = deriveStateFromBHR(champ, anchor.bhrValue, asc, SEEDER_TOLERANCE);
          if (candidate && (!bestState || candidate.absError < bestState.absError)) {
            bestState = candidate;
          }
        }
        if (bestState) {
          rosterStates.push({
            championId: anchor.championId,
            rank: bestState.rank,
            sig: bestState.sig,
            ascension: bestState.ascension,
            stateConfirmed: false,
            addedVia: 'screenshot',
          });
        } else {
          rosterStates.push({
            championId: anchor.championId,
            rank: 3,
            sig: 0,
            ascension: 'A0',
            stateConfirmed: false,
            addedVia: 'screenshot',
          });
        }
      } else {
        // No BHR — likely unowned (B&W on My Champions page), skip import.
        // Champions without BHR can't have state derived and might not be owned.
      }
    }

    seededNames.push(anchor.championName);
  }

  savePortraitStore(store);

  onProgress?.({
    kind: 'done',
    seeded: seededNames.length,
    total: allAnchors.length,
  });

  const withState = rosterStates.filter((s) => s.rank > 3 || s.sig > 0).length;
  const atFloor = rosterStates.filter((s) => s.rank === 3 && s.sig === 0).length;
  console.log(
    `[portrait-seeder] saved ${seededNames.length} portraits, ${rosterStates.length} roster states (${withState} derived, ${atFloor} at floor)`,
  );

  return {
    seeded: seededNames.length,
    champions: seededNames,
    rosterStates,
  };
}
