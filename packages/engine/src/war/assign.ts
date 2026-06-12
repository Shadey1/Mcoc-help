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
 * Power-first greedy assignment, with scarcity as tiebreaker.
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
 *   4. Walk the champion list. For each, walk its owners until we find one
 *      with a free slot; assign and move on. Skip the champion if no
 *      eligible owner has capacity.
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

  const assignments: WarAssignment[] = [];
  for (const [championId, owners] of championOrder) {
    for (const { playerId, state } of owners) {
      if ((slotsUsed.get(playerId) ?? 0) < slotsPerPlayer) {
        assignments.push({
          playerId,
          playerName: playerNameLookup.get(playerId) ?? playerId,
          championId,
          rank: state.rank,
          ascension: state.ascension,
          sig: state.sig,
        });
        slotsUsed.set(playerId, (slotsUsed.get(playerId) ?? 0) + 1);
        break;
      }
    }
  }

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
