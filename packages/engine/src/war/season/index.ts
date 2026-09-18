/**
 * Season war planner engine — public surface.
 *
 * Sibling to `../assign.ts` (the diversity engine); both share
 * `WarPlayer`, `WarStateFloor`, and `effectiveRank` from the parent
 * `war/` module. Consumers on the web side import from
 * `@prestige-tools/engine` (re-exported from `../../index.ts`).
 */

export { solvePlacement } from './solve.js';
export { fit, copyStrength, meetsFloor, resolvePicks } from './fit.js';
export { explainPlacement } from './explain.js';
export {
  ALL_NODES,
  EDGES,
  LANE,
  PT,
  lane,
  pathOf,
  pos,
  whereLabel,
} from './map.js';
export type { Edge } from './map.js';
export type {
  BgIndex,
  ChampionId,
  ExplanationLine,
  FitResult,
  NodeNumber,
  NodePlacement,
  PlaceInput,
  PlaceResult,
  PlayerId,
  Pin,
  SeasonPlan,
  UnfilledNode,
} from './types.js';
