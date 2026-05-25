// Relic engine — public types
//
// Standard 7★ statcasts share one prestige curve regardless of class, adjective,
// or "of X" effect (empirically confirmed: 12 different standard relics all read
// 1,856 BHR at R1 L0). So they're tracked as aggregated counts per (rank, level),
// not per identity.
//
// Specials (e.g. The Cosmic Egg) don't follow the standard curve and are tracked
// individually by id.

export type Rank = 1 | 2 | 3 | 4 | 5 | 6;
export type Level = 0 | 20 | 40 | 60 | 80 | 100 | 120 | 140 | 160 | 180 | 200;

export const LEVELS: readonly Level[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
] as const;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6] as const;

/** State of a single relic. Class/adjective/effect omitted: irrelevant to prestige. */
export type RelicState = {
  rank: Rank;
  level: Level;
};

/** Aggregated inventory entry: "I have N standard 7★ statcasts at this (rank, level)." */
export type RelicCountEntry = {
  rank: Rank;
  level: Level;
  count: number;
};

/** Stable id for each special relic Claude knows the curve for. */
export type SpecialRelicId = 'cosmic-egg';

/** A single owned special relic, tracked individually. */
export type SpecialRelicEntry = {
  id: SpecialRelicId;
  rank: Rank;
  level: Level;
};

/** The user's full relic inventory. */
export type RelicInventory = {
  standardCounts: RelicCountEntry[];
  specials: SpecialRelicEntry[];
};

/** Atomic moves the engine recommends. */
export type RelicMove =
  | { kind: 'level-up'; from: RelicState; toLevel: Level }
  | { kind: 'rank-up'; from: RelicState; toRank: Rank }
  | { kind: 'special-level-up'; id: SpecialRelicId; from: RelicState; toLevel: Level }
  | { kind: 'special-rank-up'; id: SpecialRelicId; from: RelicState; toRank: Rank };

export type ScoredRelicMove = {
  move: RelicMove;
  /** BHR of the relic immediately before the move. */
  beforeBHR: number;
  /**
   * BHR of the relic immediately after the move. For rank-ups this is the
   * *new rank's L200* (the ceiling the user is committing to), NOT the
   * level-reset-to-0 dip that occurs in-game right after the rank-up button.
   */
  afterBHR: number;
  delta: number;
  /** Heuristic notes for UI display, e.g. "rank-up dips before it climbs." */
  notes?: string[];
};
