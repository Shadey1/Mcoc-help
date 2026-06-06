import type {
  Champion,
  ChampionState,
  ScoredMove,
} from './types.js';
import { applyMove, optimise } from './optimise.js';
import type { BHROverrideMap } from './bhr.js';

/**
 * A single step in a multi-step plan: the move to take, plus the
 * cumulative prestige delta from step 1 through this step.
 */
export type PlanStep = {
  /** Position in the plan, 1-indexed for display. */
  index: number;
  /** The scored move (same shape as ScoredMove from optimise()). */
  move: ScoredMove;
  /** Sum of top30Delta from step 1 through this step inclusive. */
  cumulativeDelta: number;
};

/**
 * Greedy multi-step planner. At each step, runs optimise() against the
 * working roster, picks the top non-deferred move with positive delta,
 * applies it, and continues. Returns up to `targetSteps` steps; stops
 * earlier if no positive-delta non-deferred move is available.
 *
 * Why filter deferred moves: the deferral flag (architecture-v5 §8.3)
 * marks rank-ups on A0-ascendable champions — taking the rank-up before
 * ascending commits the champion to a lower ceiling. In a sequenced plan
 * we want the ascensions to happen first, then the rank-up surfaces
 * naturally (no longer deferred because the champion is now ascended).
 *
 * Why no cost-gate pool simulation: catalysts and sig stones come and
 * go via daily quests, events, and crystals — the user's effective pool
 * is dynamic and hard to model. The atomic per-move cost labels (T6B,
 * T3A, A1 cluster, etc.) are enough signal for the user to recognise
 * which moves they can actually act on.
 *
 * Why greedy is fine: most champion developments are independent (rank-up
 * X doesn't affect Y's BHR). The cases where they interact — top-30
 * displacement — are picked up correctly by re-running optimise() against
 * the updated roster after each step.
 */
export function planSteps(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
  targetSteps: number,
  overrides?: BHROverrideMap,
): PlanStep[] {
  const steps: PlanStep[] = [];
  let currentRoster = roster;
  let cumulative = 0;

  for (let i = 0; i < targetSteps; i++) {
    // optimise() returns scored moves sorted by top30Delta desc, with
    // deferred and non-deferred mixed. We want the best non-deferred move
    // with positive delta.
    const candidates = optimise(
      currentRoster,
      championLookup,
      24,
      overrides,
    ).filter((m) => !m.deferRecommendation && m.top30Delta > 0);

    if (candidates.length === 0) break;

    const chosen = candidates[0]!;
    currentRoster = applyMove(currentRoster, chosen.move);
    cumulative += chosen.top30Delta;

    steps.push({
      index: i + 1,
      move: chosen,
      cumulativeDelta: cumulative,
    });
  }

  return steps;
}
