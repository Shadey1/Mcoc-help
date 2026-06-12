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
 * Tier-respecting max bipartite matching, plus same-tier rebalance.
 *
 * Optimisation criteria, in priority order:
 *   1. NO DUPLICATES — each champion appears at most once across the table.
 *   2. ABOVE FLOOR — every placement is at or above the effective-tier
 *      floor selected by the officer.
 *   3. HIGHEST-TIER OWNER WINS — if a champion is owned by anyone at tier
 *      N, it is NEVER placed at tier <N. A R5 A0 Jean Grey beats a R4 A0
 *      Jean Grey; the algorithm only ever drops a tier when every higher-
 *      tier owner is full of their own higher-tier placements.
 *   4. MAX PLACEMENTS — fill as many slots as the pool/roster intersection
 *      structurally allows. Kuhn's gives this for free; we don't sacrifice
 *      it for tier (a tier-grouped edge list still finds the same max
 *      matching count, just at higher tier).
 *   5. FAIR DISTRIBUTION WITHIN A TIER — when two owners hold the same
 *      champ at the same effective tier, share evenly so one player isn't
 *      stacked at 5/5 while another sits at 0/5 with the same roster.
 *
 * Algorithm:
 *   1. For each champion in the defender pool, collect every eligible
 *      (player, state) pair — players who own the champion at ≥ floor.
 *   2. Sort each champion's owners by stateScore desc.
 *   3. Sort the champions by best-owner effective tier desc, tiebreak by
 *      scarcity asc (rare champs first within a tier), then championId.
 *   4. Build a bipartite graph. Each player is split into `slotsPerPlayer`
 *      slot-nodes; an edge connects a champion to slot (p, k) iff p owns
 *      the champion ≥ floor. Edges are GROUPED BY OWNER TIER DESC, then
 *      INTERLEAVED ACROSS OWNERS WITHIN A TIER: every tier-N owner's k-th
 *      slot is tried before any tier-(N-1) owner's k-th slot, and within
 *      tier-N, owner-A's slot 0 alternates with owner-B's slot 0 before
 *      anyone's slot 1. So augmenting paths exhaust same-tier alternatives
 *      before downgrading — criterion 3.
 *   5. Run Kuhn's: for each champion in championOrder, find an augmenting
 *      path via DFS.
 *   6. Post-pass: redistribute placements between (max-count, min-count)
 *      players when a same-tier swap exists — criterion 5. Tier never
 *      drops in this pass; if the only available swap is a downgrade,
 *      the imbalance stays.
 *
 * Runtime O(V × E), trivial at war scale (~80 champs × ~40 slots).
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

  // Edges grouped by owner effective tier (desc), interleaved within tier.
  //
  // The grouping is what enforces criterion 3 (highest-tier owner wins).
  // Within a champion's edge list, every slot of every tier-N owner is
  // listed before any slot of a tier-(N-1) owner. So when Kuhn's DFS
  // augments a placement, it tries other slots at the SAME tier before
  // dropping the placement to a lower-tier owner. A R5 A0 Jean Grey on
  // K-guns only moves to a R4 A0 owner if EVERY R5+ owner of Jean Grey
  // is at slot cap.
  //
  // Within a tier, slots are interleaved by k across owners: slot 0 of
  // every tier-N owner, then slot 1 of every tier-N owner, etc. — so two
  // same-tier owners share placements evenly instead of one filling first.
  type SlotKey = string; // `${playerId}::${slotIndex}`
  const edgesByChamp = new Map<string, SlotKey[]>();
  for (const [champId, owners] of championOrder) {
    const tierBuckets = new Map<number, Candidate[]>();
    for (const owner of owners) {
      const tier = effectiveRank(owner.state.rank, owner.state.ascension);
      const bucket = tierBuckets.get(tier);
      if (bucket) bucket.push(owner);
      else tierBuckets.set(tier, [owner]);
    }
    const tiersDesc = [...tierBuckets.keys()].sort((a, b) => b - a);

    const edges: SlotKey[] = [];
    for (const tier of tiersDesc) {
      const group = tierBuckets.get(tier)!;
      for (let k = 0; k < slotsPerPlayer; k++) {
        for (const owner of group) {
          edges.push(`${owner.playerId}::${k}`);
        }
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

