import type {
  ChampionId,
  NodeNumber,
  Pin,
  SeasonPlan,
} from '@prestige-tools/engine';
import type { Season } from '../../../../data/aw/season.schema';

/**
 * Pure helpers for `SeasonPlan` mutations. Kept out of the React
 * component so the state transitions are easy to reason about and unit-
 * testable if we ever want them tested. Every helper returns a new
 * plan; nothing mutates in place.
 */

export function newPlan(season: Season, bg: 1 | 2 | 3): SeasonPlan {
  const guide: Record<NodeNumber, ChampionId[]> = {};
  for (const n of season.nodes) guide[n.node] = [...n.guideDefenders];
  return {
    season: season.season,
    bg,
    guidePicks: guide,
    pickOverrides: {},
    keyNodes: new Set(season.defaultKeyNodes),
    pins: {},
    excludedPlayers: new Set(),
    strict: false,
  };
}

/** Resolve the effective picks at a node — override wins over guide. */
export function picksAt(plan: SeasonPlan, node: NodeNumber): ChampionId[] {
  const o = plan.pickOverrides[node];
  if (o !== undefined) return o;
  return plan.guidePicks[node] ?? [];
}

export function isEditedFromGuide(plan: SeasonPlan, node: NodeNumber): boolean {
  return plan.pickOverrides[node] !== undefined;
}

export function setNodePicks(
  plan: SeasonPlan,
  node: NodeNumber,
  picks: readonly ChampionId[],
): SeasonPlan {
  const guide = plan.guidePicks[node] ?? [];
  const same = picks.length === guide.length && picks.every((c, i) => c === guide[i]);
  const overrides = { ...plan.pickOverrides };
  if (same) delete overrides[node];
  else overrides[node] = [...picks];
  return { ...plan, pickOverrides: overrides };
}

export function resetNodePicks(plan: SeasonPlan, node: NodeNumber): SeasonPlan {
  const overrides = { ...plan.pickOverrides };
  delete overrides[node];
  return { ...plan, pickOverrides: overrides };
}

export function resetAllPicks(plan: SeasonPlan): SeasonPlan {
  return { ...plan, pickOverrides: {} };
}

export function clearAllPicks(plan: SeasonPlan): SeasonPlan {
  // Set every node's override to an empty array so the solver treats
  // them as pickless nodes (dv * 0.55 fallback).
  const overrides: Record<NodeNumber, ChampionId[]> = {};
  for (const n of Object.keys(plan.guidePicks)) overrides[Number(n)] = [];
  return { ...plan, pickOverrides: overrides };
}

export function toggleKeyNode(plan: SeasonPlan, node: NodeNumber): SeasonPlan {
  const next = new Set(plan.keyNodes);
  if (next.has(node)) next.delete(node);
  else next.add(node);
  return { ...plan, keyNodes: next };
}

/** Pin a champion at a node. Releases any prior pin of the same
 *  champion elsewhere — a champion is only ever pinned once. */
export function setPin(plan: SeasonPlan, node: NodeNumber, pin: Pin): SeasonPlan {
  const pins: Record<NodeNumber, Pin> = {};
  for (const [nStr, p] of Object.entries(plan.pins)) {
    const n = Number(nStr);
    if (p.championId === pin.championId) continue; // release prior pin
    pins[n] = p;
  }
  pins[node] = pin;
  return { ...plan, pins };
}

export function clearPin(plan: SeasonPlan, node: NodeNumber): SeasonPlan {
  const pins = { ...plan.pins };
  delete pins[node];
  return { ...plan, pins };
}

export function togglePlayerExcluded(plan: SeasonPlan, playerId: string): SeasonPlan {
  const next = new Set(plan.excludedPlayers);
  if (next.has(playerId)) next.delete(playerId);
  else next.add(playerId);
  return { ...plan, excludedPlayers: next };
}

export function setStrict(plan: SeasonPlan, strict: boolean): SeasonPlan {
  return { ...plan, strict };
}

/** Move a pick up (delta = -1) or down (delta = +1). No-op at bounds. */
export function movePick(
  plan: SeasonPlan,
  node: NodeNumber,
  index: number,
  delta: -1 | 1,
): SeasonPlan {
  const picks = [...picksAt(plan, node)];
  const j = index + delta;
  if (index < 0 || index >= picks.length || j < 0 || j >= picks.length) return plan;
  const tmp = picks[index]!;
  picks[index] = picks[j]!;
  picks[j] = tmp;
  return setNodePicks(plan, node, picks);
}

/** Move a pick from one index to another. Used by drag-and-drop reorder,
 *  which needs arbitrary N-to-M motion rather than adjacent swaps. */
export function reorderPick(
  plan: SeasonPlan,
  node: NodeNumber,
  fromIdx: number,
  toIdx: number,
): SeasonPlan {
  const picks = [...picksAt(plan, node)];
  if (
    fromIdx < 0 ||
    fromIdx >= picks.length ||
    toIdx < 0 ||
    toIdx >= picks.length ||
    fromIdx === toIdx
  ) {
    return plan;
  }
  const [moved] = picks.splice(fromIdx, 1);
  picks.splice(toIdx, 0, moved!);
  return setNodePicks(plan, node, picks);
}

export function removePick(plan: SeasonPlan, node: NodeNumber, index: number): SeasonPlan {
  const picks = [...picksAt(plan, node)];
  if (index < 0 || index >= picks.length) return plan;
  picks.splice(index, 1);
  return setNodePicks(plan, node, picks);
}

export function addPick(
  plan: SeasonPlan,
  node: NodeNumber,
  championId: ChampionId,
): SeasonPlan {
  const picks = picksAt(plan, node);
  if (picks.length >= 8 || picks.includes(championId)) return plan;
  return setNodePicks(plan, node, [...picks, championId]);
}
