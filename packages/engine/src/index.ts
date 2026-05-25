// Public API surface of @prestige-tools/engine
//
// Two views, one engine. See architecture-v5.md §8 for the design.

// ─── Champion engine ────────────────────────────────────────────────────────

export type {
  Ascension,
  AtomicMove,
  CeilingEntry,
  Champion,
  ChampionClass,
  ChampionState,
  CostGate,
  CostGateKind,
  Rank,
  Roster,
  ScoredMove,
  SigBrackets,
} from './types.js';

export {
  Ascension as AscensionSchema,
  AtomicMove as AtomicMoveSchema,
  Champion as ChampionSchema,
  ChampionClass as ChampionClassSchema,
  ChampionState as ChampionStateSchema,
  CostGate as CostGateSchema,
  CostGateKind as CostGateKindSchema,
  Rank as RankSchema,
  Roster as RosterSchema,
  SigBrackets as SigBracketsSchema,
} from './types.js';

// BHR + ceiling math
export {
  calculateBHR,
  calculateCeilingBHR,
  ASCENSION_MULT,
  RANK_MULT,
} from './bhr.js';

// Prestige aggregation
export {
  calculateChampionPrestige,
  top30Cutoff,
  getTop30Ids,
} from './prestige.js';

// Atomic moves view
export { enumerateMoves, applyMove, optimise } from './optimise.js';

// Ceiling view
export { computeCeilings } from './ceiling.js';

// Cost gating
export { costGatesFor, statePersistenceNoteFor } from './costs.js';

// ─── Relic engine ───────────────────────────────────────────────────────────

export type {
  Rank as RelicRank,
  Level as RelicLevel,
  RelicState,
  RelicCountEntry,
  RelicInventory,
  SpecialRelicId,
  SpecialRelicEntry,
  RelicMove,
  ScoredRelicMove,
} from './relics/types.js';

export {
  RankSchema as RelicRankSchema,
  LevelSchema as RelicLevelSchema,
  RelicStateSchema,
  RelicCountEntrySchema,
  RelicInventorySchema,
  SpecialRelicIdSchema,
  SpecialRelicEntrySchema,
} from './relics/schemas.js';

export {
  standardStatcastBHR,
  specialRelicBHR,
  standardStatcastCeiling,
  specialRelicCeiling,
} from './relics/prestige.js';

export {
  enumerateRelicMoves,
  relicBHRs,
  relicTop30Average,
} from './relics/moves.js';
