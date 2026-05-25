import {
  LEVELS,
  type Level,
  type Rank,
  type RelicState,
  type SpecialRelicId,
} from './types';
import {
  STANDARD_7STAR_STATCAST,
  SPECIALS,
  type PrestigeTable,
} from './seed';

/**
 * Look up a prestige value, interpolating linearly between known anchors
 * within the same rank. Returns null if the rank has no known anchors;
 * clamps to the nearest edge anchor if the level is outside the known range.
 *
 * Never interpolates across ranks — rank boundaries reset the relic's
 * level to 0, so cross-rank interpolation would be meaningless.
 *
 * Implementation note: builds a sorted [level, value] tuple list rather than
 * indexing into the sparse Record directly. Lets `noUncheckedIndexedAccess`
 * narrow naturally instead of requiring scattered ! assertions.
 */
function lookupOrInterpolate(
  table: PrestigeTable,
  rank: Rank,
  level: Level,
): number | null {
  const rankTable = table[rank];
  if (!rankTable) return null;

  // Build sorted list of present anchors. The filter type guard ensures
  // every tuple has a defined number, so no further undefined-checks
  // are needed when reading anchors[i][1].
  const anchors: Array<[Level, number]> = LEVELS.map(
    (l): [Level, number | undefined] => [l, rankTable[l]],
  )
    .filter((p): p is [Level, number] => p[1] !== undefined)
    .sort((a, b) => a[0] - b[0]);

  if (anchors.length === 0) return null;

  // Direct hit
  for (const [l, v] of anchors) {
    if (l === level) return v;
  }

  // Clamp outside known range
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  // Both guaranteed defined by length check, but the narrow keeps TS happy
  if (!first || !last) return null;
  if (level < first[0]) return first[1];
  if (level > last[0]) return last[1];

  // Linear interpolation between bracketing anchors
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (!lo || !hi) continue;
    if (lo[0] <= level && level <= hi[0]) {
      const t = (level - lo[0]) / (hi[0] - lo[0]);
      return Math.round(lo[1] + t * (hi[1] - lo[1]));
    }
  }

  return null;
}

/** BHR of a standard 7★ statcast at the given state. */
export function standardStatcastBHR(state: RelicState): number | null {
  return lookupOrInterpolate(STANDARD_7STAR_STATCAST, state.rank, state.level);
}

/** BHR of a special relic at the given state. */
export function specialRelicBHR(
  id: SpecialRelicId,
  state: RelicState,
): number | null {
  const special = SPECIALS[id];
  if (!special) return null;
  return lookupOrInterpolate(special.prestige, state.rank, state.level);
}

/** Ceiling BHR (rank N L200) of a standard statcast at the given rank. */
export function standardStatcastCeiling(rank: Rank): number | null {
  return lookupOrInterpolate(STANDARD_7STAR_STATCAST, rank, 200);
}

/** Ceiling BHR (rank N L200) of a special relic at the given rank. */
export function specialRelicCeiling(
  id: SpecialRelicId,
  rank: Rank,
): number | null {
  const special = SPECIALS[id];
  if (!special) return null;
  return lookupOrInterpolate(special.prestige, rank, 200);
}
