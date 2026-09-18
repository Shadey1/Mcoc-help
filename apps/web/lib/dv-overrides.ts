'use client';

/**
 * Per-alliance defender-value overrides.
 *
 * The seeded values in data/aw/defender-values.json are a neutral
 * starting point — good enough to solve, but alliances have opinions.
 * These overrides sit on top: a Record<championId, dv> in localStorage,
 * layered over the seed at solve time.
 *
 * Storage layout:
 *   dv-overrides → { [championId]: number }   0..100
 *
 * Removing an override is done by setting the same value as the seed
 * (or by hand — we keep the raw record simple). Every accessor is
 * try/catch-wrapped for private windows / disabled storage.
 */

const STORAGE_KEY = 'dv-overrides';

export type DvOverrides = Record<string, number>;

export function readDvOverrides(): DvOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: DvOverrides = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeDvOverride(championId: string, dv: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(dv)));
  try {
    const current = readDvOverrides();
    current[championId] = clamped;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

export function clearDvOverride(championId: string): void {
  try {
    const current = readDvOverrides();
    delete current[championId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

/** Layer the officer's overrides on top of the seed map. */
export function overlayDvOverrides(
  seed: ReadonlyMap<string, number>,
  overrides: DvOverrides,
): Map<string, number> {
  const merged = new Map(seed);
  for (const [id, v] of Object.entries(overrides)) {
    merged.set(id, v);
  }
  return merged;
}
