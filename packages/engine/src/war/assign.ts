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
 * Algorithm (two-phase):
 *   1. For each champion, collect every eligible (player, state) pair —
 *      players who own the champion at ≥ floor. Sort owners by stateScore
 *      desc. Sort champions by best-owner tier desc → scarcity asc →
 *      championId.
 *   2. Build TWO edge lists per champion:
 *        - phase1Edges: only the best-tier owners' slots.
 *        - phase2Edges: every owner's slots, grouped by tier desc with
 *          interleaving within tier.
 *   3. PHASE 1 — strict best-tier matching. For each champion in order,
 *      run Kuhn's DFS but restricted to phase1Edges for BOTH the caller
 *      and any displaced champion. A champion can only move between its
 *      own best-tier slots. A R5 A2 Maestro on Jpang stays at tier 7
 *      forever; the augmenting path tries Jpang's other slots before
 *      giving up. If Jpang is genuinely full of OTHER tier-6+ best
 *      champs, Maestro stays put and a different champ is left for Phase 2.
 *   4. PHASE 2 — downgrade fallback. For champions still unplaced after
 *      Phase 1, retry with phase2Edges as the CALLER's edge list (lower-
 *      tier owners now in scope), but any DISPLACED champion still uses
 *      phase1Edges. Only the unplaced champ absorbs a tier drop; already-
 *      placed champions stay at their best tier.
 *   5. Post-pass: redistribute placements between (max-count, min-count)
 *      players when a same-tier swap exists — criterion 5. Tier never
 *      drops in this pass.
 *
 * Trade-off: this is no longer pure max-matching. A champ that can't fit
 * at its best tier and has no other owner stays unplaced rather than
 * dropping below best-tier. The user explicitly asked for "highest-tier
 * owner wins for each champ" over "fill every slot at any tier".
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

  // Two edge lists per champion:
  //   phase1Edges: only the BEST-TIER owners' slots. Augmenting paths
  //     restricted to these never displace a placement below its best
  //     tier — that's how criterion 3 is enforced.
  //   phase2Edges: every owner's slot, grouped by tier desc. Used in the
  //     downgrade-fallback phase for champions that couldn't fit at their
  //     best tier (the slot was full of OTHER best-tier-N champions).
  // Within each tier in either list, slots are interleaved by k across
  // owners so same-tier owners share placements evenly (criterion 5).
  type SlotKey = string; // `${playerId}::${slotIndex}`
  const phase1Edges = new Map<string, SlotKey[]>();
  const phase2Edges = new Map<string, SlotKey[]>();
  for (const [champId, owners] of championOrder) {
    const bestTier = effectiveRank(
      owners[0]!.state.rank,
      owners[0]!.state.ascension,
    );
    const bestTierOwners = owners.filter(
      (o) =>
        effectiveRank(o.state.rank, o.state.ascension) === bestTier,
    );
    const phase1: SlotKey[] = [];
    for (let k = 0; k < slotsPerPlayer; k++) {
      for (const owner of bestTierOwners) {
        phase1.push(`${owner.playerId}::${k}`);
      }
    }
    phase1Edges.set(champId, phase1);

    const tierBuckets = new Map<number, Candidate[]>();
    for (const owner of owners) {
      const tier = effectiveRank(owner.state.rank, owner.state.ascension);
      const bucket = tierBuckets.get(tier);
      if (bucket) bucket.push(owner);
      else tierBuckets.set(tier, [owner]);
    }
    const tiersDesc = [...tierBuckets.keys()].sort((a, b) => b - a);
    const phase2: SlotKey[] = [];
    for (const tier of tiersDesc) {
      const group = tierBuckets.get(tier)!;
      for (let k = 0; k < slotsPerPlayer; k++) {
        for (const owner of group) {
          phase2.push(`${owner.playerId}::${k}`);
        }
      }
    }
    phase2Edges.set(champId, phase2);
  }

  const matching = new Map<SlotKey, string>(); // slot -> championId

  // Phase 1 — strict best-tier matching. The displaced champ in augmenting
  // is restricted to its own phase1Edges, so it can only move to ANOTHER
  // of its best-tier slots. It cannot drop a tier to make room.
  function tryAugmentPhase1(
    champId: string,
    visited: Set<SlotKey>,
  ): boolean {
    const edges = phase1Edges.get(champId);
    if (!edges) return false;
    for (const slot of edges) {
      if (visited.has(slot)) continue;
      visited.add(slot);
      const occupant = matching.get(slot);
      if (occupant === undefined || tryAugmentPhase1(occupant, visited)) {
        matching.set(slot, champId);
        return true;
      }
    }
    return false;
  }

  for (const [champId] of championOrder) {
    tryAugmentPhase1(champId, new Set());
  }

  // Phase 2 — downgrade fallback. For champions still unplaced after
  // Phase 1, attempt placement across the full tier-grouped edge list.
  // The CALLER may end up at a lower-tier slot (acceptable: the
  // alternative is leaving the champ unplaced). But any DISPLACED champ
  // along the augmenting path is restricted to phase1Edges, so it stays
  // at its best tier. This is the key asymmetry: only the unplaced
  // champion absorbs the downgrade.
  const placedChamps = new Set<string>(matching.values());

  function tryAugmentPhase2Caller(
    champId: string,
    visited: Set<SlotKey>,
  ): boolean {
    const edges = phase2Edges.get(champId);
    if (!edges) return false;
    for (const slot of edges) {
      if (visited.has(slot)) continue;
      visited.add(slot);
      const occupant = matching.get(slot);
      if (occupant === undefined || tryAugmentPhase1(occupant, visited)) {
        matching.set(slot, champId);
        return true;
      }
    }
    return false;
  }

  for (const [champId] of championOrder) {
    if (placedChamps.has(champId)) continue;
    tryAugmentPhase2Caller(champId, new Set());
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

