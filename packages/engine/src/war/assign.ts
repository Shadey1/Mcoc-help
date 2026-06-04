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
 * True if the state meets-or-exceeds the floor.
 * Compares rank first (higher always wins), then ascension as the
 * second axis. Sig is not a floor concern — it's only a tiebreaker.
 */
function meetsFloor(state: ChampionState, floor: WarStateFloor): boolean {
  if (state.rank > floor.rank) return true;
  if (state.rank < floor.rank) return false;
  return ASC_TIER[state.ascension] >= ASC_TIER[floor.ascension];
}

/**
 * Score a champion state for tiebreaking: rank → ascension → sig.
 * Encoded as a single sortable number with large step sizes so a lower
 * tier can never beat a higher tier (R4 A2 sig 200 < R5 A0 sig 0).
 */
function stateScore(state: ChampionState): number {
  return state.rank * 1_000_000 + ASC_TIER[state.ascension] * 1_000 + state.sig;
}

/**
 * Score a state for the output sort within a player's row. Same encoding
 * as stateScore but exposed so callers can mirror the engine's row order.
 */
export function assignmentStateScore(a: WarAssignment): number {
  return a.rank * 1_000_000 + ASC_TIER[a.ascension] * 1_000 + a.sig;
}

type Candidate = {
  playerId: WarPlayerId;
  state: ChampionState;
};

/**
 * Scarcity-first greedy assignment.
 *
 * Algorithm:
 *   1. For each champion in the defender pool, collect every eligible
 *      (player, state) pair — i.e. players who own the champion at ≥ floor.
 *   2. Sort each champion's owners by stateScore desc, so the best-developed
 *      owner is preferred.
 *   3. Sort the champions themselves by owner-count asc (rarest first),
 *      tiebreak by best-owner state desc (so among equally-rare champs,
 *      the highest-tier one is placed first).
 *   4. Walk the champion list. For each, walk its owners until we find one
 *      with a free slot; assign and move on. Skip the champion if no
 *      eligible owner has capacity.
 *
 * Why scarcity first: a R4 Modok owned by one player would lose out to a
 * R5 Photon owned by eight if we sorted purely by rank tier — the Modok
 * owner would burn their slots on common metas. Processing scarce champs
 * first locks the unique placements in before the common pool gets carved
 * up.
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

  // Champions sorted by scarcity asc (rarest first), tiebreak by
  // best-owner state desc, then by championId for determinism.
  const championOrder = [...candidatesByChamp.entries()].sort((a, b) => {
    const scarcityDelta = a[1].length - b[1].length;
    if (scarcityDelta !== 0) return scarcityDelta;
    const stateDelta = stateScore(b[1][0]!.state) - stateScore(a[1][0]!.state);
    if (stateDelta !== 0) return stateDelta;
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
