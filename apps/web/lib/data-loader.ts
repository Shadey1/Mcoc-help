import type { Champion } from '@prestige-tools/engine';
import seedData from '../../../data/champions/seed.json' with { type: 'json' };

/**
 * Load all champions from the seed file, including those marked as not yet
 * released at 7-star (Goldpool, Platinum Pool, etc.). This is the right
 * source for browsing/reference views — the champions browser shows them
 * with a "Coming soon" badge.
 *
 * For engine inputs use `loadActiveChampions()` instead — placeholder
 * entries should not contribute to prestige calculations.
 *
 * In v2 this will be replaced with an `ingest` script that pulls fresh from
 * MCOCHUB nightly and commits the result. For now: hand-curated seed.
 */
export function loadAllChampions(): Champion[] {
  return seedData.champions as Champion[];
}

/**
 * Load only champions actually released at 7-star — the set the engine should
 * use for optimisation, ceiling computation, picker/bulk-import options, etc.
 *
 * Also filters out partner-only stub entries (sevenStarReleased=false AND no
 * prestige data) so the engine never sees a champion without prestige curves.
 */
export function loadActiveChampions(): Champion[] {
  return loadAllChampions().filter(
    (c) => c.sevenStarReleased !== false && c.prestige !== undefined,
  );
}

export function loadChampionLookup(): Map<string, Champion> {
  return new Map(loadAllChampions().map((c) => [c.id, c]));
}

/**
 * Lookup map containing only active (released-at-7-star) champions. Use as the
 * championLookup argument to engine functions to prevent placeholder data from
 * leaking into prestige calculations.
 */
export function loadActiveChampionLookup(): Map<string, Champion> {
  return new Map(loadActiveChampions().map((c) => [c.id, c]));
}

export function findChampionById(id: string): Champion | undefined {
  return loadAllChampions().find((c) => c.id === id);
}
