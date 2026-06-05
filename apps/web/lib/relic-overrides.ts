'use client';

import type { R6StatcastLevel, R6StatcastRank } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-relic-overrides-v1';

/**
 * User-supplied calibration overrides for 6★ relic prestige values.
 *
 * Two override maps, keyed differently:
 *   - Statcast overrides: keyed by (rank, sig) — the curve is shared across
 *     all 6★ standard statcasts.
 *   - Battlecast overrides: keyed by (relicId, rank, sig) — battlecasts
 *     have per-relic curves.
 *
 * Local-only by design. Same pattern as the champion BHR override
 * (lib/bhr-overrides.ts). Each override applies only to the user who
 * set it; the optional report-back flow shares it with mcoc.help for
 * Dave to fold into the seed.
 */

export type RelicOverrideKey = string;

export function statcast6Key(rank: R6StatcastRank, sig: R6StatcastLevel): RelicOverrideKey {
  return `s|${rank}|${sig}`;
}

export function battlecast6Key(
  relicId: string,
  rank: R6StatcastRank,
  sig: R6StatcastLevel,
): RelicOverrideKey {
  return `b|${relicId}|${rank}|${sig}`;
}

export type RelicOverrideMap = Map<RelicOverrideKey, number>;

export function loadRelicOverrides(): RelicOverrideMap {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<RelicOverrideKey, number>();
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

export function saveRelicOverrides(overrides: RelicOverrideMap): void {
  if (typeof window === 'undefined') return;
  const obj: Record<string, number> = {};
  for (const [k, v] of overrides) obj[k] = v;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

export function setRelicOverride(
  current: RelicOverrideMap,
  key: RelicOverrideKey,
  value: number,
): RelicOverrideMap {
  const next = new Map(current);
  next.set(key, Math.round(value));
  return next;
}

export function clearRelicOverride(
  current: RelicOverrideMap,
  key: RelicOverrideKey,
): RelicOverrideMap {
  const next = new Map(current);
  next.delete(key);
  return next;
}
