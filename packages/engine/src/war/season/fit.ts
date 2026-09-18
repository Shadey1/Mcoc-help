import type { Ascension, ChampionState } from '../../types.js';
import { effectiveRank } from '../assign.js';
import type {
  ChampionId,
  FitResult,
  NodeNumber,
  SeasonPlan,
} from './types.js';

/**
 * Resolve the effective pick list at a node: override wins over the guide,
 * absence of both = no picks. Returned array is read-only; callers must
 * not mutate.
 */
export function resolvePicks(plan: SeasonPlan, node: NodeNumber): readonly ChampionId[] {
  const o = plan.pickOverrides[node];
  if (o !== undefined) return o;
  return plan.guidePicks[node] ?? [];
}

/**
 * Fit score for placing `championId` on `node` under `plan` and the given
 * per-champion `defenderValues`. Higher score = better fit.
 *
 * Weight `w` is 3 for key nodes (they get first claim in ties), 1.5 for
 * everything else. Sitting on the picks list at index `i` earns
 * `w × (100 − 9i)` — so the 1st pick beats the 8th by a factor of ~3.6
 * before the key-node weight amplifies it. Off the list but in strict-off
 * mode earns a flat `w × dv × 0.3` (much lower — this is the "planner's
 * choice" fallback that fills gaps). A node with no picks at all falls
 * through to `dv × 0.55`, ignoring key-node weight (an unlisted node has
 * no first choice to protect).
 *
 * Returns null when the edge is forbidden — strict mode on and the
 * champion isn't listed. The solver reads null as "don't add the edge".
 */
export function fit(
  championId: ChampionId,
  node: NodeNumber,
  plan: SeasonPlan,
  defenderValues: ReadonlyMap<ChampionId, number>,
): FitResult {
  const picks = resolvePicks(plan, node);
  const w = plan.keyNodes.has(node) ? 3 : 1.5;
  const dv = defenderValues.get(championId) ?? 50;
  if (picks.length > 0) {
    const i = picks.indexOf(championId);
    if (i >= 0) return { score: w * (100 - 9 * i), rank: i };
    if (plan.strict) return null;
    return { score: w * dv * 0.3, rank: -1 };
  }
  return { score: dv * 0.55, rank: -2 };
}

/**
 * Copy-strength tiebreak — how strong is *this* player's copy of the
 * champion. Larger = preferred owner between two candidates. Uses the
 * effective-rank ladder (rank + ascension) as the coarse signal and sig
 * as a fine tiebreak. The output isn't normalised — the solver applies
 * an ×10 scale in cost space, and the raw range only needs to be small
 * relative to fit scores (fit dominates, strength refines).
 *
 *   R4 A0 sig 0    → 4.0
 *   R5 A0 sig 200  → 5.5
 *   R5 A2 sig 200  → 7.5
 *   R6 A2 sig 200  → 9.5
 */
export function copyStrength(state: ChampionState): number {
  const eff = effectiveRank(state.rank, state.ascension);
  return eff + (state.sig / 200) * 0.5;
}

/** True when the state meets the floor by effective rank. Mirrors the
 *  diversity engine's private helper so both stay consistent. */
export function meetsFloor(
  state: ChampionState,
  floor: { rank: number; ascension: Ascension },
): boolean {
  return (
    effectiveRank(state.rank, state.ascension) >=
    effectiveRank(floor.rank, floor.ascension)
  );
}
