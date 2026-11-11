import { resolvePicks } from './fit.js';
import type {
  ChampionId,
  ExplanationLine,
  NodeNumber,
  PlayerId,
  SeasonPlan,
  WarTier,
} from './types.js';

/**
 * Explain a node's placement. For each pick that ranks above the chosen
 * one, produce one line saying what happened to it — placed elsewhere,
 * unowned, or its owners all ran out of slots.
 *
 * Consumed by the node-panel result card. The UI shows at most the first
 * few lines; the engine returns everything so the caller decides on
 * truncation.
 *
 *   input node = 27, chosen champion at pick-rank 3
 *     → returns lines for picks 0, 1, 2 (why not them?)
 *
 * When the chosen placement is at pick-rank 0 (top pick) or −2 (unlisted
 * node), the trace is empty by definition. Rank −1 (planner's fallback)
 * walks the whole pick list.
 *
 * With a defender `pool` or diversity `assignments` (the same ones the
 * solve ran with), a pick outside them is reported as such rather than as
 * unowned or out of slots.
 */
export function explainPlacement(
  node: NodeNumber,
  chosenPickRank: number,
  plan: SeasonPlan,
  placementsByChampion: ReadonlyMap<ChampionId, { node: NodeNumber; playerId: PlayerId }>,
  owners: ReadonlyMap<ChampionId, PlayerId[]>,
  pool?: ReadonlyMap<ChampionId, WarTier>,
  assignments?: ReadonlyMap<PlayerId, ReadonlySet<ChampionId>>,
): ExplanationLine[] {
  const picks = resolvePicks(plan, node);
  if (picks.length === 0) return [];
  let assigned: Set<ChampionId> | null = null;
  if (assignments) {
    assigned = new Set();
    for (const ids of assignments.values()) for (const c of ids) assigned.add(c);
  }
  const limit = chosenPickRank >= 0 ? chosenPickRank : picks.length;
  const out: ExplanationLine[] = [];
  for (let i = 0; i < limit; i++) {
    const c = picks[i]!;
    if (assigned && !assigned.has(c)) {
      out.push({ pickIndex: i, championId: c, reason: 'not-assigned' });
      continue;
    }
    if (pool && !pool.has(c)) {
      out.push({ pickIndex: i, championId: c, reason: 'not-in-pool' });
      continue;
    }
    const ownerList = owners.get(c) ?? [];
    if (ownerList.length === 0) {
      out.push({ pickIndex: i, championId: c, reason: 'nobody-owns' });
      continue;
    }
    const placed = placementsByChampion.get(c);
    if (placed) {
      out.push({
        pickIndex: i,
        championId: c,
        reason: 'placed-elsewhere',
        placedNode: placed.node,
        placedBy: placed.playerId,
      });
      continue;
    }
    out.push({ pickIndex: i, championId: c, reason: 'no-free-slot' });
  }
  return out;
}
