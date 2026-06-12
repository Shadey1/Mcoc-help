import type { Ascension, ChampionState, Rank } from '../types.js';
import type {
  WarAssignment,
  WarInput,
  WarPlayerId,
  WarResult,
  WarStateFloor,
  WarUnderfilledPlayer,
} from './types.js';

const ASC_TIER: Record<Ascension, number> = { A0: 0, A1: 1, A2: 2 };

/**
 * Base power for an unascended rank. R6 sits a full ascension step above R5
 * because in-game R5 A2 and R6 A0 are equivalent power tiers — going up
 * from R5 max takes a big jump (dual T6 catalysts) that's worth two
 * ascension-equivalents, not one.
 *
 * R1/R2 are out of scope for war (no defenders sit there) but the table
 * carries placeholder values for type completeness.
 */
const RANK_BASE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7 };

/**
 * Effective power tier on the in-game ladder:
 *   R4 < R4 A1 ≡ R5 A0 < R4 A2 ≡ R5 A1 < R5 A2 ≡ R6 A0 < R6 A1 < R6 A2.
 * Computed as RANK_BASE[rank] + ascension level. Tied tiers (R4 A1 and
 * R5 A0, etc.) are deliberately interchangeable; sig breaks the tie.
 */
function effectiveRank(rank: number, ascension: Ascension): number {
  return (RANK_BASE[rank] ?? rank) + ASC_TIER[ascension];
}

/**
 * True if the state meets-or-exceeds the floor by effective rank.
 * E.g. floor R5 (effective 5) accepts R4 A1 (5), R4 A2 (6), R5 A0 (5),
 * R5 A1 (6), R5 A2 (7) — but rejects R4 A0 (4).
 */
function meetsFloor(state: ChampionState, floor: WarStateFloor): boolean {
  return (
    effectiveRank(state.rank, state.ascension) >=
    effectiveRank(floor.rank, floor.ascension)
  );
}

/**
 * Score a champion state for tiebreaking: effective rank, then sig.
 * Encoded as a single sortable number — effective rank dominates, sig is
 * the within-tier tiebreaker. Tied effective ranks (e.g. R5 A0 vs R4 A1)
 * are intentionally interchangeable; sig decides between them.
 */
function stateScore(state: ChampionState): number {
  return effectiveRank(state.rank, state.ascension) * 1_000 + state.sig;
}

/**
 * Score a state for the output sort within a player's row. Same encoding
 * as stateScore but exposed so callers can mirror the engine's row order.
 */
export function assignmentStateScore(a: WarAssignment): number {
  return effectiveRank(a.rank, a.ascension) * 1_000 + a.sig;
}

type Candidate = {
  playerId: WarPlayerId;
  state: ChampionState;
};

/**
 * Power-first max bipartite matching via Kuhn's algorithm.
 *
 * Algorithm:
 *   1. For each champion in the defender pool, collect every eligible
 *      (player, state) pair — players who own the champion at ≥ floor.
 *   2. Sort each champion's owners by stateScore desc, so the best-developed
 *      owner gets first try.
 *   3. Sort the champions by best-owner effective tier desc, tiebreak by
 *      scarcity asc (rare champs first within a tier), then championId.
 *   4. Build a bipartite graph: each player is split into `slotsPerPlayer`
 *      slot-nodes; an edge connects a champion to slot (p, k) iff p owns
 *      the champion ≥ floor. Slot edges are interleaved across owners
 *      (for each k, list every owner's k-th slot before the next k) so
 *      Kuhn's distributes placements evenly across owners at the same
 *      tier instead of stacking on the alphabetically-first one.
 *   5. Run Kuhn's: for each champion in tier order, try to find an
 *      augmenting path via DFS. Champions that come earlier (higher tier)
 *      take precedence; later ones displace them only when the augmenting
 *      path finds an alternative slot for the displaced champion.
 *
 * Why max matching: earlier greedy + 1-step-repair variants left
 * placements on the table when the augmenting path needed two or more
 * concurrent swaps. Kuhn's finds every placement that is structurally
 * possible given the roster overlaps — equivalent to min-cost flow's
 * max-flow component for unit capacities. Runtime is O(V × E), which is
 * trivial at war scale (~80 champs × ~40 slots).
 *
 * Tier optimisation is the secondary objective via championOrder: high-
 * tier champions are tried first and only displaced when necessary. Sig
 * is a tertiary signal (owners pre-sorted by sig within tier). Slot
 * interleaving handles the load-balance objective.
 */
export function assignWar(input: WarInput): WarResult {
  const slotsPerPlayer = input.slotsPerPlayer ?? 5;

  // Group eligible (player, state) pairs by champion id.
  const candidatesByChamp = new Map<string, Candidate[]>();
  for (const player of input.players) {
    for (const state of player.roster) {
      if (!input.defenderPool.has(state.championId)) continue;
      if (!meetsFloor(state, input.floor)) continue;
      const existing = candidatesByChamp.get(state.championId);
      if (existing) {
        existing.push({ playerId: player.id, state });
      } else {
        candidatesByChamp.set(state.championId, [{ playerId: player.id, state }]);
      }
    }
  }

  // Within each champion, best-developed owner first.
  // Stable tiebreak by playerId so results are deterministic.
  for (const owners of candidatesByChamp.values()) {
    owners.sort((a, b) => {
      const delta = stateScore(b.state) - stateScore(a.state);
      if (delta !== 0) return delta;
      return a.playerId.localeCompare(b.playerId);
    });
  }

  // Champions sorted by best-owner state desc (power first), tiebreak by
  // scarcity asc (rarest within a tier first), then by championId for
  // determinism.
  const championOrder = [...candidatesByChamp.entries()].sort((a, b) => {
    const stateDelta = stateScore(b[1][0]!.state) - stateScore(a[1][0]!.state);
    if (stateDelta !== 0) return stateDelta;
    const scarcityDelta = a[1].length - b[1].length;
    if (scarcityDelta !== 0) return scarcityDelta;
    return a[0].localeCompare(b[0]);
  });

  // Slot tracking
  const slotsUsed = new Map<WarPlayerId, number>();
  const playerNameLookup = new Map<WarPlayerId, string>();
  for (const p of input.players) {
    slotsUsed.set(p.id, 0);
    playerNameLookup.set(p.id, p.name);
  }

  // Max bipartite matching via Kuhn's algorithm with augmenting-path DFS.
  //
  // Each player is represented as `slotsPerPlayer` slot nodes; an edge
  // connects a champion to a slot iff its player owns the champion ≥ floor.
  // Processing champions in championOrder (best-owner state desc, scarcity
  // asc) gives high-tier champions first claim — augmenting paths displace
  // earlier placements only when necessary to fit a new one.
  //
  // Edges are interleaved by slot-index across owners: for each k from 0
  // to slotsPerPlayer-1, every owner's k-th slot is listed before any
  // owner's (k+1)-th. This means a champion's first attempt fills the
  // first owner's slot 0; the second attempt finds slot 0 taken and goes
  // to the second owner's slot 0; etc. — distributing placements evenly
  // across owners at the same tier instead of stacking on whichever owner
  // happens to be alphabetically first.
  type SlotKey = string; // `${playerId}::${slotIndex}`
  const edgesByChamp = new Map<string, SlotKey[]>();
  for (const [champId, owners] of championOrder) {
    const edges: SlotKey[] = [];
    for (let k = 0; k < slotsPerPlayer; k++) {
      for (const owner of owners) {
        edges.push(`${owner.playerId}::${k}`);
      }
    }
    edgesByChamp.set(champId, edges);
  }

  const matching = new Map<SlotKey, string>(); // slot -> championId

  function tryAugment(champId: string, visited: Set<SlotKey>): boolean {
    const edges = edgesByChamp.get(champId);
    if (!edges) return false;
    for (const slot of edges) {
      if (visited.has(slot)) continue;
      visited.add(slot);
      const occupant = matching.get(slot);
      if (occupant === undefined || tryAugment(occupant, visited)) {
        matching.set(slot, champId);
        return true;
      }
    }
    return false;
  }

  for (const [champId] of championOrder) {
    tryAugment(champId, new Set());
  }

  // Convert the matching back to WarAssignment[].
  const assignments: WarAssignment[] = [];
  for (const [slotKey, champId] of matching) {
    const sepIdx = slotKey.lastIndexOf('::');
    const playerId = slotKey.slice(0, sepIdx);
    const owners = candidatesByChamp.get(champId) ?? [];
    // The slot's player must own this champion (otherwise the edge wouldn't
    // exist). Pick the candidate row that matches the player to recover its
    // state.
    const owner = owners.find((o) => o.playerId === playerId);
    if (!owner) continue;
    assignments.push({
      playerId,
      playerName: playerNameLookup.get(playerId) ?? playerId,
      championId: champId,
      rank: owner.state.rank,
      ascension: owner.state.ascension,
      sig: owner.state.sig,
    });
    slotsUsed.set(playerId, (slotsUsed.get(playerId) ?? 0) + 1);
  }

  // Max-min redistribution.
  //
  // Kuhn's gives the optimum placement COUNT but the distribution can be
  // uneven: when many champions are co-owned at the same tier, augmenting
  // paths tend to land them on the alphabetically-earliest player's slots
  // first. The total is right; whose row is full vs partial is biased.
  //
  // Walk pairs of (max-count player, min-count player). If the max player
  // holds a champion that the min player ALSO owns at the same effective
  // tier, reassign it. Each swap shrinks the slot-count gap by 1 with no
  // change to total placements and no drop in tier (a R5 A2 placement can
  // never be downgraded to a R5 A0 by this pass). Iterates until the
  // distribution is within 1 of perfectly even, or no further tier-
  // preserving swap exists.
  redistributeForFairness(
    assignments,
    candidatesByChamp,
    slotsUsed,
    playerNameLookup,
  );

  // Output sort: by playerId, then state desc within each player.
  assignments.sort((a, b) => {
    if (a.playerId !== b.playerId) return a.playerId.localeCompare(b.playerId);
    return assignmentStateScore(b) - assignmentStateScore(a);
  });

  // Underfilled players
  const underfilled: WarUnderfilledPlayer[] = [];
  for (const p of input.players) {
    const assigned = slotsUsed.get(p.id) ?? 0;
    if (assigned < slotsPerPlayer) {
      underfilled.push({
        playerId: p.id,
        playerName: p.name,
        assigned,
        needed: slotsPerPlayer,
      });
    }
  }

  // Unavailable champions (in pool but no eligible owner)
  const unavailableChamps: string[] = [];
  for (const championId of input.defenderPool) {
    if (!candidatesByChamp.has(championId)) {
      unavailableChamps.push(championId);
    }
  }
  unavailableChamps.sort();

  return {
    assignments,
    underfilled,
    unavailableChamps,
    totalPlaced: assignments.length,
  };
}

/**
 * Max-min redistribution post-pass. Walks (max-count player, min-count
 * player) pairs and reassigns shared-tier placements from the over-filled
 * player to the under-filled one. Mutates `assignments` and `slotsUsed`.
 *
 * Convergence: each swap reduces (max − min) by 1 or leaves the pair
 * unchanged if no tier-preserving swap exists. The safety iteration cap
 * (200) is well above any realistic war scale; the loop also exits early
 * as soon as the slot-count gap is ≤ 1 (perfect balance modulo rounding).
 */
function redistributeForFairness(
  assignments: WarAssignment[],
  candidatesByChamp: Map<string, Candidate[]>,
  slotsUsed: Map<WarPlayerId, number>,
  playerNameLookup: Map<WarPlayerId, string>,
): void {
  let safetyIters = 0;
  while (safetyIters++ < 200) {
    let maxCount = -Infinity;
    let minCount = Infinity;
    for (const count of slotsUsed.values()) {
      if (count > maxCount) maxCount = count;
      if (count < minCount) minCount = count;
    }
    if (maxCount - minCount <= 1) return;

    let swapped = false;
    for (let i = 0; i < assignments.length && !swapped; i++) {
      const curr = assignments[i]!;
      const currCount = slotsUsed.get(curr.playerId) ?? 0;
      if (currCount !== maxCount) continue;
      const currTier = effectiveRank(curr.rank, curr.ascension);

      const candidates = candidatesByChamp.get(curr.championId) ?? [];
      for (const alt of candidates) {
        if (alt.playerId === curr.playerId) continue;
        const altCount = slotsUsed.get(alt.playerId) ?? 0;
        if (altCount !== minCount) continue;
        const altTier = effectiveRank(alt.state.rank, alt.state.ascension);
        // Tier preservation: never downgrade a placement just to balance
        // the row. R5 A2 placements stay R5 A2; swapping to a R5 A0 owner
        // would lower the overall defence strength.
        if (altTier !== currTier) continue;

        assignments[i] = {
          playerId: alt.playerId,
          playerName: playerNameLookup.get(alt.playerId) ?? alt.playerId,
          championId: curr.championId,
          rank: alt.state.rank,
          ascension: alt.state.ascension,
          sig: alt.state.sig,
        };
        slotsUsed.set(curr.playerId, currCount - 1);
        slotsUsed.set(alt.playerId, altCount + 1);
        swapped = true;
      }
    }

    if (!swapped) return;
  }
}

