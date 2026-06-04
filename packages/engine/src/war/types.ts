import type { Ascension, ChampionState, Rank } from '../types.js';

/**
 * War defence placement — types for the assignment engine.
 *
 * Problem: an alliance officer needs to place 50 unique defenders across
 * 10 alliance members (5 slots each). Each champion may only be placed
 * once total. Want to maximise rank tier per placement (BHR is not the
 * factor — rank is), with diversity guaranteed by the uniqueness constraint.
 * Rarer champions (owned by fewer players) are placed first so they don't
 * lose out to common ones.
 */

/** Stable id for one alliance member in this war session. */
export type WarPlayerId = string;

/**
 * Minimum acceptable state for a champion to be considered placeable.
 * E.g. `{ rank: 4, ascension: 'A0' }` means champion must be ≥ R4 A0.
 *
 * Sig is intentionally not part of the floor — for war defence it acts as
 * a tiebreaker, not a gate.
 */
export type WarStateFloor = {
  rank: Rank;
  ascension: Ascension;
};

/** One alliance member loaded into the war planner. */
export type WarPlayer = {
  id: WarPlayerId;
  /** In-game name, used in the output table. Officer-set, may differ from
   *  the name baked into the share-link payload. */
  name: string;
  /** Champions this player owns at any state. Engine filters by floor. */
  roster: ChampionState[];
};

/** Inputs to the assignment algorithm. */
export type WarInput = {
  /** Champion IDs the officer has designated as war-worthy defenders.
   *  Anything not in this set is ignored, even if a player owns it. */
  defenderPool: ReadonlySet<string>;
  /** Minimum acceptable state. Champs below this floor don't count, even
   *  if they're in the defender pool. */
  floor: WarStateFloor;
  /** Alliance members + their rosters. Order doesn't affect placement; the
   *  engine sorts internally. */
  players: WarPlayer[];
  /** How many champs each player places. Default 5 (standard war BG size). */
  slotsPerPlayer?: number;
};

/** A single placement decision. */
export type WarAssignment = {
  playerId: WarPlayerId;
  playerName: string;
  championId: string;
  rank: Rank;
  ascension: Ascension;
  sig: number;
};

/** Player who couldn't fill their full slot count given the inputs. */
export type WarUnderfilledPlayer = {
  playerId: WarPlayerId;
  playerName: string;
  assigned: number;
  needed: number;
};

/** Output of the assignment algorithm. */
export type WarResult = {
  /** All placements made. Sorted by playerId asc, then by rank tier desc. */
  assignments: WarAssignment[];
  /** Players with fewer than `slotsPerPlayer` placements. Empty if all full. */
  underfilled: WarUnderfilledPlayer[];
  /** Champion IDs in the defender pool that no player held at ≥ floor.
   *  Useful diagnostic for officers: "raise the pool or lower the floor." */
  unavailableChamps: string[];
  /** Total assignments made. Will be ≤ players.length × slotsPerPlayer. */
  totalPlaced: number;
};
