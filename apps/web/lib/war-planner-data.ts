import { Season, DefenderValues } from '../../../data/aw/season-69.schema';
import season69 from '../../../data/aw/season-69.json' with { type: 'json' };
import defenderValuesFile from '../../../data/aw/defender-values.json' with { type: 'json' };

/**
 * Static loaders for the season file and defender values.
 *
 * The season file bundles into the client at build time (small — ~15KB
 * for 50 nodes × 8 picks). Officers can't edit it from the UI; when we
 * re-run the extractor and Season 70 lands, it's a build-time swap.
 *
 * Defender values are also bundled at build time. They're expected to
 * drift more often than the season file (alliances have opinions), so
 * v2 will let officers override per-alliance via a shared knob; today
 * they're a single build-time constant.
 */
// Parsed at module load so a malformed data file fails the static
// build (pages prerender at build time) instead of reaching users.
const season = Season.parse(season69);
const defenderValues = DefenderValues.parse(defenderValuesFile);

export function loadSeason(): Season {
  return season;
}

export function loadDefenderValues(): DefenderValues {
  return defenderValues;
}

/** Convert the DefenderValues envelope into the ReadonlyMap the engine
 *  wants. Cached at module scope — recomputing 266 entries every render
 *  would be silly. */
let defenderValuesMap: ReadonlyMap<string, number> | null = null;
export function defenderValueMap(): ReadonlyMap<string, number> {
  if (defenderValuesMap) return defenderValuesMap;
  const values = loadDefenderValues().values;
  defenderValuesMap = new Map(Object.entries(values));
  return defenderValuesMap;
}
