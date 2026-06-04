'use client';

import { bhrOverrideKey, type Ascension, type Rank } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-bhr-overrides-v1';

/**
 * User-supplied BHR overrides — when our engine's prediction disagrees
 * with the in-game number, the user pins the actual value for that exact
 * (champion, rank, sig, ascension) state.
 *
 * Local-only by design. An override applied here NEVER affects other
 * users. The optional report flow (task #41) is the path for sending a
 * curve correction back to mcoc.help.
 *
 * Storage shape: plain { [key]: number } JSON object, where key matches
 * the engine's `bhrOverrideKey(championId, rank, sig, ascension)`.
 */

export type BHROverrideRecord = {
  championId: string;
  rank: Rank;
  sig: number;
  ascension: Ascension;
  value: number;
};

/** Load the saved overrides into a Map. Returns empty if none saved. */
export function loadOverrides(): Map<string, number> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<string, number>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out.set(key, Math.round(value));
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveOverrides(overrides: Map<string, number>): void {
  if (typeof window === 'undefined') return;
  const obj: Record<string, number> = {};
  for (const [k, v] of overrides) obj[k] = v;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/** Set a single override; returns the new map (does not mutate the input). */
export function setOverride(
  current: Map<string, number>,
  record: BHROverrideRecord,
): Map<string, number> {
  const next = new Map(current);
  next.set(
    bhrOverrideKey(record.championId, record.rank, record.sig, record.ascension),
    Math.round(record.value),
  );
  return next;
}

/** Clear a single override; returns the new map (does not mutate the input). */
export function clearOverride(
  current: Map<string, number>,
  championId: string,
  rank: Rank,
  sig: number,
  ascension: Ascension,
): Map<string, number> {
  const next = new Map(current);
  next.delete(bhrOverrideKey(championId, rank, sig, ascension));
  return next;
}

/** True if the user has pinned a BHR for this exact state. */
export function hasOverride(
  overrides: Map<string, number>,
  championId: string,
  rank: Rank,
  sig: number,
  ascension: Ascension,
): boolean {
  return overrides.has(bhrOverrideKey(championId, rank, sig, ascension));
}
