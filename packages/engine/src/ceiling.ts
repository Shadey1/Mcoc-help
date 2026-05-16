import type {
  AtomicMove,
  CeilingEntry,
  Champion,
  ChampionState,
  CostGate,
} from './types.js';
import { calculateBHR, calculateCeilingBHR } from './bhr.js';
import { getTop30Ids, top30Cutoff } from './prestige.js';
import { costGatesFor } from './costs.js';

/**
 * Compute the ceiling view: for every champion under consideration, where
 * they sit now (or zero, if not yet owned), where they could be fully
 * developed (R5 sig 200 max ascension), and the prestige impact if maxed.
 *
 * If `allChampions` is omitted, only roster champions are considered —
 * the legacy "what should I focus on in my own roster" view. If
 * `allChampions` is provided, the result includes unowned champions too,
 * marked with `owned: false` — answering "what should I want to pull?"
 *
 * Prestige impact (`prestigeDeltaIfMaxed`) tiers:
 *
 *   - Owned IN top-30: improving the slot they occupy
 *     impact = (ceiling − current) / 30
 *
 *   - Owned OUTSIDE top-30, ceiling > cutoff: displacing rank-30 if developed
 *     impact = (ceiling − cutoff) / 30
 *
 *   - Unowned, ceiling > cutoff: displacing rank-30 if acquired AND developed
 *     impact = (ceiling − cutoff) / 30
 *
 *   - Else: zero impact (not surfaced)
 */
export function computeCeilings(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
  allChampions?: Champion[],
): CeilingEntry[] {
  const cutoff = top30Cutoff(roster, championLookup);
  const top30Ids = getTop30Ids(roster, championLookup);

  // Map roster states by championId for fast owned-state lookup
  const stateById = new Map(roster.map((s) => [s.championId, s]));

  // Population: explicit allChampions list OR just the roster
  const population: Champion[] = allChampions
    ? allChampions
    : roster
        .map((s) => championLookup.get(s.championId))
        .filter((c): c is Champion => Boolean(c));

  const entries: CeilingEntry[] = population.map((champion) => {
    const state = stateById.get(champion.id);
    const owned = Boolean(state);

    const currentBHR = state ? calculateBHR(champion, state) : 0;
    const ceilingBHR = calculateCeilingBHR(champion);
    const headroomBHR = Math.max(0, ceilingBHR - currentBHR);
    const inTop30 = owned && top30Ids.has(champion.id);

    let prestigeDeltaIfMaxed: number;
    if (inTop30) {
      prestigeDeltaIfMaxed = headroomBHR / 30;
    } else if (ceilingBHR > cutoff) {
      prestigeDeltaIfMaxed = (ceilingBHR - cutoff) / 30;
    } else {
      prestigeDeltaIfMaxed = 0;
    }

    return {
      championId: champion.id,
      championName: champion.name,
      championClass: champion.class,
      owned,
      currentBHR,
      ceilingBHR,
      headroomBHR,
      prestigeDeltaIfMaxed,
      inTop30,
      ascendable: champion.ascendable,
      totalCostGates: state ? cumulativeCostGates(state, champion) : [],
    };
  });

  return entries.sort((a, b) => b.prestigeDeltaIfMaxed - a.prestigeDeltaIfMaxed);
}

/**
 * The sequence of atomic moves that would take an owned champion from
 * current state to ceiling (R5 sig 200 + max ascension if ascendable).
 *
 * Returns moves in the order "ascend before rank" per the v5 deferral rule
 * — i.e. if currently A0-ascendable, ascend first, then rank up, then sig up.
 */
function pathToMax(state: ChampionState, champion: Champion): AtomicMove[] {
  const moves: AtomicMove[] = [];

  if (champion.ascendable) {
    if (state.ascension === 'A0') {
      moves.push({
        kind: 'ascend',
        championId: state.championId,
        fromAscension: 'A0',
        toAscension: 'A1',
      });
      moves.push({
        kind: 'ascend',
        championId: state.championId,
        fromAscension: 'A1',
        toAscension: 'A2',
      });
    } else if (state.ascension === 'A1') {
      moves.push({
        kind: 'ascend',
        championId: state.championId,
        fromAscension: 'A1',
        toAscension: 'A2',
      });
    }
  }

  if (state.rank === 4) {
    moves.push({
      kind: 'rank-up',
      championId: state.championId,
      fromRank: 4,
      toRank: 5,
    });
  }

  if (state.sig < 200) {
    moves.push({
      kind: 'sig-up',
      championId: state.championId,
      fromSig: state.sig,
      toSig: 200,
    });
  }

  return moves;
}

function cumulativeCostGates(state: ChampionState, champion: Champion): CostGate[] {
  const path = pathToMax(state, champion);
  const allGates = path.flatMap((move) => costGatesFor(move, champion));

  const seen = new Set<string>();
  return allGates.filter((g) => {
    if (seen.has(g.kind)) return false;
    seen.add(g.kind);
    return true;
  });
}
