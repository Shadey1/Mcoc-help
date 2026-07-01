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
  bhrOverrideKey,
} from './bhr.js';

export type { BHROverrideMap } from './bhr.js';

// Prestige aggregation
export {
  calculateChampionPrestige,
  top30Cutoff,
  getTop30Ids,
} from './prestige.js';

// Atomic moves view
export { enumerateMoves, applyMove, optimise } from './optimise.js';

// Multi-step plan (atomic moves sequenced)
export { planSteps } from './plan.js';
export type { PlanStep } from './plan.js';

// Ceiling view
export { computeCeilings } from './ceiling.js';

// Cost gating
export { costGatesFor, statePersistenceNoteFor } from './costs.js';

// ─── Relic engine ───────────────────────────────────────────────────────────

export type {
  Rank as RelicRank,
  Level as RelicLevel,
  StarTier as RelicStarTier,
  RelicState,
  RelicCountEntry,
  RelicInventory,
  SpecialRelicId,
  SpecialRelicEntry,
  Battlecast6Entry,
  RelicMove,
  ScoredRelicMove,
} from './relics/types.js';

export {
  RankSchema as RelicRankSchema,
  LevelSchema as RelicLevelSchema,
  StarTierSchema as RelicStarTierSchema,
  RelicStateSchema,
  RelicCountEntrySchema,
  RelicInventorySchema,
  SpecialRelicIdSchema,
  SpecialRelicEntrySchema,
  Battlecast6EntrySchema,
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

export type { RelicOverrides } from './relics/moves.js';

// ─── 6★ Statcast relic prestige (v2 alpha — reference only) ────────────────
//
// Prefixed `r6Statcast*` to keep names from colliding with the existing
// 7★ module (which already exports `RelicRank` as the 1..6 numeric).
// Surfaced for the /relics reference card; NOT wired to the recommendations
// or roster engine yet.
export {
  relicRating as r6StatcastRating,
  RELIC_RATING as R6_STATCAST_RATING,
  RELIC_RANKS as R6_STATCAST_RANKS,
  LEVEL_BRACKETS as R6_STATCAST_LEVELS,
} from './relic.js';

export type {
  RelicRank as R6StatcastRank,
  LevelBracket as R6StatcastLevel,
  RelicRating as R6StatcastRating,
} from './relic.js';

// ─── 6★ Battlecast catalogue (v2 alpha — reference + submission) ───────────
//
// Per-relic-id table for champion-bound battlecast relics. Cosmic Egg has
// one verified anchor; everything else has only the MCOCHUB ranking value
// (alpha-flagged). Not wired to roster / recommendations.
export {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
  battlecast6Rating,
} from './battlecast.js';

export type {
  Battlecast6Id,
  Battlecast6Class,
  Battlecast6Def,
  Battlecast6Rating,
} from './battlecast.js';

// ─── War defence placement ──────────────────────────────────────────────────

export type {
  WarPlayerId,
  WarStateFloor,
  WarPlayer,
  WarInput,
  WarAssignment,
  WarTier,
  WarUnderfilledPlayer,
  WarResult,
} from './war/types.js';

export { assignWar, assignmentStateScore, effectiveRank } from './war/assign.js';

// ─── Immunity query engine ─────────────────────────────────────────────────

export {
  IMMUNITY_EFFECTS,
  ALL_BANDS_ON,
  isEffectivelyImmune,
  bandScore,
  hitScore,
  queryImmunities,
  coverAllButOne,
  effectRosterCounts,
} from './immunities.js';

export type {
  EffectName,
  ImmunityBand,
  BandKind,
  ChampionImmunities,
  ImmunityDataset,
  BandFilter,
  QueryMode,
  ImmunityHit,
} from './immunities.js';

// Immunity text parser (used by the reconciliation pipeline)
export {
  parseImmunitiesFromLines,
  parseKitLine,
  guardsPass,
  inflictGuardFires,
  enclosingSentence,
  normaliseEffect,
  parseSignedPercent,
  NEGATION_PATTERNS,
} from './immunity-text-parser.js';

export type {
  ParsedBand,
  ParsedChampionImmunities,
} from './immunity-text-parser.js';

// Immunity reconciliation (source votes → verdict + confidence tier)
export {
  reconcile,
  votesAgree,
  DEFAULT_FRESHNESS,
  DEFAULT_RESIST_TOLERANCE,
} from './immunity-reconciliation.js';

export type {
  SourceName,
  SourceFreshness,
  Vote,
  Confidence,
  Verdict,
  Reconciled,
  ReconcileOptions,
} from './immunity-reconciliation.js';
