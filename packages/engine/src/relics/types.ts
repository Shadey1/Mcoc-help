// Relic engine — public types
//
// Standard statcasts share one prestige curve regardless of class, adjective,
// or "of X" effect (empirically confirmed: 12 different standard relics all
// read 1,856 BHR at R1 L0 at the 7★ tier; the 6★ tier follows the same
// shape with different anchors). So they're tracked as aggregated counts
// per (starTier, rank, level), not per identity.
//
// Specials (7★ Cosmic Egg) and 6★ battlecasts don't follow the standard
// curve and are tracked individually by id.

/** Which star tier of relic. v1 covers 6★ and 7★ — older tiers are out of
 *  scope (most paragon rosters won't have them in top-30). */
export type StarTier = 6 | 7;

export type Rank = 1 | 2 | 3 | 4 | 5 | 6;
export type Level = 0 | 20 | 40 | 60 | 80 | 100 | 120 | 140 | 160 | 180 | 200;

export const LEVELS: readonly Level[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
] as const;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6] as const;

export const STAR_TIERS: readonly StarTier[] = [6, 7] as const;

/** State of a single relic. Class/adjective/effect omitted: irrelevant to prestige. */
export type RelicState = {
  rank: Rank;
  level: Level;
};

/** Aggregated inventory entry: "I have N standard statcasts at this (starTier, rank, level)." */
export type RelicCountEntry = {
  starTier: StarTier;
  rank: Rank;
  level: Level;
  count: number;
};

/** Stable id for each 7★ special relic Claude knows the curve for. */
export type SpecialRelicId = 'cosmic-egg';

/** A single owned 7★ special relic, tracked individually. */
export type SpecialRelicEntry = {
  id: SpecialRelicId;
  rank: Rank;
  level: Level;
};

/** A single owned 6★ battlecast relic, tracked individually by id. The id
 *  is one of `Battlecast6Id` from src/battlecast.ts; typed as string here
 *  to avoid the cross-module import (the engine's lookup gracefully
 *  returns null for unknown ids). */
export type Battlecast6Entry = {
  id: string;
  rank: Rank;
  level: Level;
};

/** The user's full relic inventory. */
export type RelicInventory = {
  /** 6★ and 7★ standard statcasts (discriminated by starTier per entry). */
  standardCounts: RelicCountEntry[];
  /** 7★ specials (currently just Cosmic Egg). */
  specials: SpecialRelicEntry[];
  /** 6★ battlecasts — each individual, identified by Battlecast6Id. */
  battlecasts6Star: Battlecast6Entry[];
};

/** Atomic moves the engine recommends. */
export type RelicMove =
  | { kind: 'level-up'; starTier: StarTier; from: RelicState; toLevel: Level }
  | { kind: 'rank-up'; starTier: StarTier; from: RelicState; toRank: Rank }
  | { kind: 'special-level-up'; id: SpecialRelicId; from: RelicState; toLevel: Level }
  | { kind: 'special-rank-up'; id: SpecialRelicId; from: RelicState; toRank: Rank }
  | { kind: 'battlecast6-level-up'; id: string; from: RelicState; toLevel: Level }
  | { kind: 'battlecast6-rank-up'; id: string; from: RelicState; toRank: Rank };

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
