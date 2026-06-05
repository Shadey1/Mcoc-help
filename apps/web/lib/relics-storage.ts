'use client';

import { z } from 'zod';
import { RelicInventorySchema, type RelicInventory } from '@prestige-tools/engine';

const STORAGE_KEY = 'mcoc-help-relics-v1';

/**
 * Bundle of state persisted to localStorage. The inventory is the engine's
 * input; the cutoff is a UI-side number the user reads off the in-game
 * Prestige page (the BHR of their 30th-best relic). Together they fully
 * describe the user's relic situation.
 */
const RelicStateBundleSchema = z.object({
  inventory: RelicInventorySchema,
  top30Cutoff: z.number().int().min(0),
});

export type RelicStateBundle = z.infer<typeof RelicStateBundleSchema>;

const EMPTY: RelicStateBundle = {
  inventory: { standardCounts: [], specials: [], battlecasts6Star: [] },
  top30Cutoff: 0,
};

/**
 * Load the saved relic bundle from localStorage. Returns an empty bundle
 * if none is saved or if parsing fails (defensive — schema may evolve).
 */
export function loadRelics(): RelicStateBundle {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    const result = RelicStateBundleSchema.safeParse(parsed);
    return result.success ? result.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Save the relic bundle to localStorage. */
export function saveRelics(bundle: RelicStateBundle): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}
