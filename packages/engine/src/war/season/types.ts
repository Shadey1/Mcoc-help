import type { WarPlayer, WarStateFloor } from '../types.js';

/**
 * Season war planner — types for the per-node placement engine.
 *
 * Problem: an alliance officer needs to place 50 defenders on the 50 nodes
 * of a war map, one per node, no duplicates within a BG. Every node ships
 * with an ordered list of up to 8 "guide picks" from an external source
 * (GuiaMTC). The officer can edit picks, mark nodes as key, and pin
 * specific defenders. The engine solves the placement optimally under
 * those constraints — pick-order fit dominates, copy strength is a
 * rounding tiebreak.
 *
 * This is a per-BG problem — cross-BG optimisation is out of scope.
 * Sibling to the diversity engine at `packages/engine/src/war/assign.ts`,
 * which solves the alliance-wide diversity problem (different constraint,
 * different scoring). Both share `WarPlayer`, `WarStateFloor`, and
 * `effectiveRank`; kept separate so a change to one doesn't distort the
 * other.
 */

export type ChampionId = string;
export type PlayerId = string;

/** War map node 1..50. */
export type NodeNumber = number;

/** Battlegroup selector — an alliance has 3 BGs, each solved independently. */
export type BgIndex = 1 | 2 | 3;

/**
 * A pin fixes a champion to a specific node. Two flavours:
 *   - With a player: that player's copy is used; the player's remaining
 *     slot count drops by one.
 *   - Any owner: the champion may only go to that node, and that node
 *     only accepts that champion — but which owner supplies the copy is
 *     up to the solver.
 * A champion is never pinned twice; a re-pin releases any prior pin.
 */
export type Pin = {
  championId: ChampionId;
  playerId: PlayerId | null;
};

/**
 * The plan is the shareable, edit-able state of one BG's placement:
 * which picks are current, which nodes are key, what's pinned, who's
 * absent. Guide picks come frozen from the season file; overrides are
 * the officer's per-node edits. Storing overrides only (rather than the
 * full 50 lists) means a mid-season guide correction flows through to
 * un-edited nodes automatically.
 */
export type SeasonPlan = {
  season: number;
  bg: BgIndex;
  /** Frozen at plan-load time from the season file; not mutated. */
  guidePicks: Record<NodeNumber, ChampionId[]>;
  /** Officer edits, per node. If a node's key is absent, guidePicks apply. */
  pickOverrides: Record<NodeNumber, ChampionId[]>;
  keyNodes: ReadonlySet<NodeNumber>;
  /** Node → pin. Absence = no pin. */
  pins: Record<NodeNumber, Pin>;
  /** Players marked as not placing this war; their slots vanish. */
  excludedPlayers: ReadonlySet<PlayerId>;
  /**
   * Strict mode: nodes with any picks REJECT champions not on the list.
   * Off by default — the "planner's-choice" fallback with `dv × 0.3` fills
   * gaps but marks the ring differently in the UI.
   */
  strict: boolean;
  /**
   * The prior solve's placements. Fed back into the next solve to earn
   * a stability bonus so a small edit doesn't reshuffle the whole map.
   * Absent on a first solve.
   */
  lastPlacement?: Record<NodeNumber, NodePlacement>;
};

/**
 * One node's placement. `pickRank` is the index into the resolved pick
 * list at the time of placement — a snapshot, not a live lookup, so the
 * UI's "1st choice / 3rd choice" label stays stable if picks are later
 * edited. Sentinel values:
 *   -1 = the champion isn't on the node's picks (planner-fallback fill)
 *   -2 = the node had no picks at all (pure-dv fill)
 */
export type NodePlacement = {
  championId: ChampionId;
  playerId: PlayerId;
  pickRank: number;
  pinned: boolean;
};

/** A node the solver could not fill, with the reason surfaced to the UI. */
export type UnfilledNode = {
  node: NodeNumber;
  reason: string;
};

/** Complete input to `solvePlacement`. */
export type PlaceInput = {
  plan: SeasonPlan;
  /** BG members. Order doesn't matter — engine sorts internally. */
  players: WarPlayer[];
  /** Minimum eligible state. Reuses the diversity tool's floor concept. */
  floor: WarStateFloor;
  /** Per-champion defender value ∈ [0, 100]. Seeded from the tier map. */
  defenderValues: ReadonlyMap<ChampionId, number>;
  /** Optional: number of slots per player. Default 5. */
  slotsPerPlayer?: number;
};

/** Full solver output. */
export type PlaceResult = {
  placements: Record<NodeNumber, NodePlacement>;
  unfilled: UnfilledNode[];
  /** Node numbers that moved between plan.lastPlacement and this result. */
  moved: NodeNumber[];
};

/**
 * Fit-score result for one (champion, node) pair. Null means the edge is
 * forbidden — a strict-mode node the champion isn't on. Otherwise `score`
 * is the (positive) fit value and `rank` is the pick index used to
 * generate it (or −1 / −2 sentinels as above).
 */
export type FitResult = {
  score: number;
  rank: number;
} | null;

/**
 * One line of an explanation trace for a placement that didn't get the
 * top pick. UI renders these as "1st pick <name>: placed on N by Y".
 */
export type ExplanationLine = {
  pickIndex: number;
  championId: ChampionId;
  reason: 'placed-elsewhere' | 'nobody-owns' | 'no-free-slot';
  /** Present when reason === 'placed-elsewhere'. */
  placedNode?: NodeNumber;
  placedBy?: PlayerId;
};

export type { WarPlayer, WarStateFloor };
