'use client';

import { hammingDistance } from './phash';

/**
 * Per-user, locally-stored library of confirmed champion portraits.
 *
 * Why this exists: the user's actual screenshots are game-client portraits
 * with compression, frame overlays, and platform-specific colour grading.
 * Any bundled portrait library built from wiki renders would be structurally
 * different from the screenshots we're trying to match against — hashing two
 * visually-different versions of the same champion and asking them to match.
 * That mismatch was the noise floor.
 *
 * Solution: every time the user CONFIRMS a champion identification in the
 * confirmation grid, we hash the cropped portrait region as-it-appeared and
 * store it here. Future imports query against these self-supplied portraits —
 * same device, same client, same compression — and the hash distance drops
 * to near zero on a true match.
 *
 * The store is per-user (localStorage) and starts EMPTY. It builds up
 * organically through use. Until populated, the OCR pipeline relies on
 * name-OCR signal alone; this is fine because name OCR + fuzzy matching
 * (alias map, Levenshtein) is already a strong standalone signal.
 *
 * Each champion can have multiple stored portraits (up to MAX_PER_CHAMPION).
 * Match function returns the MINIMUM distance across all stored variants for
 * that champion — so multiple confirmations build a richer fingerprint that
 * tolerates day-to-day variation across screenshots/devices.
 */

const STORAGE_KEY = 'mcoc-help-portraits-v1';
const MAX_PER_CHAMPION = 5;

export type ConfirmedPortrait = {
  /** 16-char hex aHash (64-bit average-hash). */
  hash: string;
  /** ISO timestamp of when this confirmation happened. */
  capturedAt: string;
  /** Small JPEG dataURL for diagnostic display. Empty string if generation failed. */
  thumbnailDataUrl: string;
};

export type PortraitStore = {
  /** championId → list of confirmed portraits, newest first. */
  byChampion: Record<string, ConfirmedPortrait[]>;
};

const EMPTY_STORE: PortraitStore = { byChampion: {} };

/**
 * Load the portrait store from localStorage. Returns empty store if none
 * saved or if parsing fails (defensive — schema may evolve).
 */
export function loadPortraitStore(): PortraitStore {
  if (typeof window === 'undefined') return EMPTY_STORE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.byChampion !== 'object') return EMPTY_STORE;
    return parsed as PortraitStore;
  } catch {
    return EMPTY_STORE;
  }
}

/**
 * Save the portrait store to localStorage. Trims to MAX_PER_CHAMPION
 * entries per champion (newest kept) before persistence. If the resulting
 * payload exceeds localStorage quota, retries with a tighter trim; if that
 * also fails, drops silently rather than crashing — the portrait store is
 * an enhancement, not critical.
 */
export function savePortraitStore(store: PortraitStore): void {
  if (typeof window === 'undefined') return;
  const trimmed: PortraitStore = { byChampion: {} };
  for (const [id, portraits] of Object.entries(store.byChampion)) {
    trimmed.byChampion[id] = portraits.slice(0, MAX_PER_CHAMPION);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[portrait-store] save failed, retrying with tighter trim:', e);
    const harder: PortraitStore = { byChampion: {} };
    for (const [id, portraits] of Object.entries(trimmed.byChampion)) {
      harder.byChampion[id] = portraits.slice(0, 2);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(harder));
    } catch {
      // Give up — portrait store is enhancement, not critical
    }
  }
}

/**
 * Add a confirmed portrait to the store, returning the new store.
 * Pure function — caller is responsible for calling savePortraitStore.
 */
export function addPortrait(
  store: PortraitStore,
  championId: string,
  portrait: ConfirmedPortrait,
): PortraitStore {
  const existing = store.byChampion[championId] ?? [];
  return {
    byChampion: {
      ...store.byChampion,
      [championId]: [portrait, ...existing],
    },
  };
}

/**
 * Find the closest champion match across all stored portraits.
 * Returns matches sorted by distance ascending, capped at topN.
 *
 * Each champion's score is its MINIMUM distance across all stored variants —
 * so multiple confirmations give the lookup more chances to find a close match.
 */
export function findClosestInStore(
  needle: string,
  store: PortraitStore,
  maxDistance = 16,
  topN = 5,
): Array<{ championId: string; distance: number }> {
  const results: Array<{ championId: string; distance: number }> = [];
  for (const [championId, portraits] of Object.entries(store.byChampion)) {
    let minDist = Infinity;
    for (const p of portraits) {
      try {
        const d = hammingDistance(needle, p.hash);
        if (d < minDist) minDist = d;
      } catch {
        // Invalid hash in store (corruption / schema drift); skip silently
      }
    }
    if (minDist <= maxDistance && minDist !== Infinity) {
      results.push({ championId, distance: minDist });
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, topN);
}

/**
 * Generate a small JPEG thumbnail of a canvas region. Used to give each
 * confirmed-portrait entry a visual representation for diagnostic UI.
 *
 * Returns empty string on failure (rare — only if canvas API is unavailable).
 */
export async function generateThumbnail(
  source: HTMLCanvasElement | OffscreenCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  size = 64,
): Promise<string> {
  const thumb = new OffscreenCanvas(size, size);
  const ctx = thumb.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, width, height, 0, 0, size, size);
  try {
    const blob = await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return await blobToDataUrl(blob);
  } catch {
    return '';
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Diagnostic — number of champions and total portraits in store. */
export function portraitStoreSize(store: PortraitStore): {
  champions: number;
  totalPortraits: number;
} {
  let totalPortraits = 0;
  for (const portraits of Object.values(store.byChampion)) {
    totalPortraits += portraits.length;
  }
  return {
    champions: Object.keys(store.byChampion).length,
    totalPortraits,
  };
}
