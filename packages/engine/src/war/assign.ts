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
 * Power-first greedy assignment with load-balancing tiebreaker.
 *
 * Algorithm:
 *   1. For each champion in the defender pool, collect every eligible
 *      (player, state) pair — i.e. players who own the champion at ≥ floor.
 *   2. Sort each champion's owners by stateScore desc, so the best-developed
 *      owner is preferred.
 *   3. Sort the champions themselves by best-owner effective tier desc
 *      (the "highest placements first" rule from the floor dropdown),
 *      tiebreak by scarcity asc (rarer locked in first within a tier),
 *      tiebreak by championId for determinism.
 *   4. Walk the champion list. For each, find the best owner by:
 *         effective tier desc → slots-used asc (load balance) →
 *         sig desc → playerId asc.
 *      Without the slots-used tiebreaker the alphabetically-first owner
 *      wins every state tie and fills to 5 before any other equally-
 *      developed player gets a placement; balancing it gives roughly
 *      equal counts across owners who hold the same tier.
 *      Skip the champion if no eligible owner has capacity.
 *
 * Why power first: officers want their strongest defenders deployed. The
 * earlier scarcity-first variant prioritised unique meta locks at the cost
 * of bumping R5s out of the placement set when their owners' slots were
 * eaten by rare R4s. Real users said "my best defence" means tier-first;
 * scarcity drops to a within-tier preference, so rare R5 metas still beat
 * common R5s in the same effective tier.
 *
 * This is a greedy heuristic, not provably optimal. Min-cost flow would
 * give the exact optimum, but at 10 players × ~60 candidates the greedy
 * result is essentially always good enough — and explainable, which
 * matters for an officer-facing tool. Upgrade-in-place if real data
 * surfaces a bad outcome.
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

  // For each champion, pick its owner by (effective tier desc, slots-used
  // asc, sig desc, playerId asc). The slots-used tiebreaker is the
  // load-balancing fairness fix: when two owners hold a champ at the same
  // effective tier (e.g. K-guns and jpang both have it at R5 A2), the one
  // who's been assigned fewer slots so far wins. Without this, the
  // alphabetically-first owner wins every tie and fills to 5 before any
  // other equally-developed player gets a single placement.
  const assignments: WarAssignment[] = [];
  for (const [championId, owners] of championOrder) {
    let chosen: Candidate | null = null;
    let chosenTier = -Infinity;
    let chosenUsed = Infinity;
    let chosenSig = -Infinity;
    for (const candidate of owners) {
      const used = slotsUsed.get(candidate.playerId) ?? 0;
      if (used >= slotsPerPlayer) continue;
      const tier = effectiveRank(
        candidate.state.rank,
        candidate.state.ascension,
      );
      const sig = candidate.state.sig;
      if (tier > chosenTier) {
        chosen = candidate;
        chosenTier = tier;
        chosenUsed = used;
        chosenSig = sig;
      } else if (tier === chosenTier) {
        if (used < chosenUsed) {
          chosen = candidate;
          chosenUsed = used;
          chosenSig = sig;
        } else if (used === chosenUsed && sig > chosenSig) {
          chosen = candidate;
          chosenSig = sig;
        }
        // else: keep current (owners array is pre-sorted by playerId asc
        // when state ties, so the first hit is the deterministic winner).
      }
    }
    if (chosen) {
      assignments.push({
        playerId: chosen.playerId,
        playerName: playerNameLookup.get(chosen.playerId) ?? chosen.playerId,
        championId,
        rank: chosen.state.rank,
        ascension: chosen.state.ascension,
        sig: chosen.state.sig,
      });
      slotsUsed.set(
        chosen.playerId,
        (slotsUsed.get(chosen.playerId) ?? 0) + 1,
      );
    }
  }

  // Repair pass — augmenting-path swaps.
  //
  // Greedy can leave a champion stuck if its only eligible owners are at
  // slot cap, even when one of those owners holds a champ that COULD have
  // gone to a different player who still has a free slot. Walking the
  // stuck list and trying 1-step swaps (reassign an existing placement to
  // an alternative owner with capacity, freeing the original owner to take
  // the stuck champ) recovers those misses. Iterating finds 2- and 3-step
  // chains too — each iteration completes one swap, and the next iteration
  // sees the updated slot state.
  //
  // The repair only ever performs swaps that result in a NET +1 placement.
  // It may drop one placement's effective tier (the swapped champ might be
  // at a lower state on the alternative owner) — accepted because the user
  // explicitly preferred coverage over a per-slot tier optimum.
  repairByAugmentingPaths(
    assignments,
    candidatesByChamp,
    slotsUsed,
    slotsPerPlayer,
    playerNameLookup,
    input.defenderPool,
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
 * Iterative 1-step swap repair (a poor man's augmenting-path optimisation).
 *
 * After greedy assignment, a champion may sit unplaced even though one of
 * its eligible owners is at slot cap with placements that other players
 * could've taken instead. This pass walks the unplaced list and, for each,
 * tries to:
 *   1. Trivially place it if its owner now has capacity (rare — only if a
 *      prior repair iteration moved one of their champs out).
 *   2. Otherwise find ANY current placement on that owner whose champion
 *      has an alternative owner with a free slot. Swap: the alternative
 *      owner takes the existing placement (at their own state), and the
 *      previously-full owner uses the freed slot for the stuck champ.
 *
 * Each completed swap is a strict +1 placement. Repeated iterations chain
 * 1-step swaps into the longer augmenting paths that a true min-cost-flow
 * algorithm would find directly. The safety iteration cap (100) bounds
 * pathological cases — well above any realistic ~50-slot war run.
 *
 * Mutates `assignments` and `slotsUsed` in place.
 */
function repairByAugmentingPaths(
  assignments: WarAssignment[],
  candidatesByChamp: Map<string, Candidate[]>,
  slotsUsed: Map<WarPlayerId, number>,
  slotsPerPlayer: number,
  playerNameLookup: Map<WarPlayerId, string>,
  defenderPool: ReadonlySet<string>,
): void {
  // championId -> index in `assignments`, for O(1) lookup and in-place swap.
  const indexByChamp = new Map<string, number>();
  for (let i = 0; i < assignments.length; i++) {
    indexByChamp.set(assignments[i]!.championId, i);
  }

  let safetyIters = 0;
  while (safetyIters < 100) {
    safetyIters++;

    // Collect champs that are in pool, have at least one eligible owner,
    // but aren't placed yet. Re-collected each iteration because a prior
    // swap can move a champ in or out of this set.
    const stuck: string[] = [];
    for (const champ of defenderPool) {
      if (indexByChamp.has(champ)) continue;
      if (!candidatesByChamp.has(champ)) continue;
      stuck.push(champ);
    }
    if (stuck.length === 0) break;

    let progress = false;

    for (const stuckChamp of stuck) {
      const stuckOwners = candidatesByChamp.get(stuckChamp)!;
      let swapDone = false;

      for (const stuckOwner of stuckOwners) {
        const pid = stuckOwner.playerId;
        const used = slotsUsed.get(pid) ?? 0;

        if (used < slotsPerPlayer) {
          // Owner has capacity — trivial direct place. Possible if an
          // earlier iteration's swap freed a slot on this player.
          assignments.push({
            playerId: pid,
            playerName: playerNameLookup.get(pid) ?? pid,
            championId: stuckChamp,
            rank: stuckOwner.state.rank,
            ascension: stuckOwner.state.ascension,
            sig: stuckOwner.state.sig,
          });
          indexByChamp.set(stuckChamp, assignments.length - 1);
          slotsUsed.set(pid, used + 1);
          swapDone = true;
          break;
        }

        // Owner is full — find one of their current placements to move to
        // an alternative owner with capacity.
        for (let i = 0; i < assignments.length && !swapDone; i++) {
          const curr = assignments[i]!;
          if (curr.playerId !== pid) continue;

          const altOwners = candidatesByChamp.get(curr.championId) ?? [];
          for (const alt of altOwners) {
            if (alt.playerId === pid) continue;
            const altUsed = slotsUsed.get(alt.playerId) ?? 0;
            if (altUsed >= slotsPerPlayer) continue;

            // Execute swap.
            assignments[i] = {
              playerId: alt.playerId,
              playerName: playerNameLookup.get(alt.playerId) ?? alt.playerId,
              championId: curr.championId,
              rank: alt.state.rank,
              ascension: alt.state.ascension,
              sig: alt.state.sig,
            };
            assignments.push({
              playerId: pid,
              playerName: playerNameLookup.get(pid) ?? pid,
              championId: stuckChamp,
              rank: stuckOwner.state.rank,
              ascension: stuckOwner.state.ascension,
              sig: stuckOwner.state.sig,
            });
            indexByChamp.set(curr.championId, i);
            indexByChamp.set(stuckChamp, assignments.length - 1);
            slotsUsed.set(alt.playerId, altUsed + 1);
            // pid's slot count is unchanged (released curr, took stuckChamp).
            swapDone = true;
            break;
          }
        }

        if (swapDone) break;
      }

      if (swapDone) {
        progress = true;
        break; // restart from the top of the stuck list
      }
    }

    if (!progress) break;
  }
}
