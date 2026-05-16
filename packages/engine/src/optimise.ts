import type {
  AtomicMove,
  Champion,
  ChampionState,
  Rank,
  ScoredMove,
} from './types.js';
import { calculateBHR, RANK_MULT } from './bhr.js';
import { calculateChampionPrestige } from './prestige.js';
import { costGatesFor, statePersistenceNoteFor } from './costs.js';

/**
 * Enumerate every atomic move available from a roster.
 *
 * "Atomic" = a single rank-up, sig-up, or ascension step. The optimiser
 * never composes multi-step moves; the ceiling view answers compound-path
 * questions separately.
 *
 * Scope rules:
 * - Rank-up: R4→R5 only in v1 (R3 supported as input but no R3→R4 move yet)
 * - Sig-up: full jump to sig 200 (intermediate sig levels are too granular)
 * - Ascend: A0→A1 or A1→A2, only for `ascendable: true` champions
 */
export function enumerateMoves(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
): AtomicMove[] {
  const moves: AtomicMove[] = [];

  for (const state of roster) {
    const champion = championLookup.get(state.championId);
    if (!champion) continue;

    // Rank up: R4 → R5
    if (state.rank === 4 && RANK_MULT[5] !== undefined) {
      moves.push({
        kind: 'rank-up',
        championId: state.championId,
        fromRank: 4,
        toRank: 5,
      });
    }

    // Sig up: full jump to sig 200 (smaller increments deferred)
    if (state.sig < 200) {
      moves.push({
        kind: 'sig-up',
        championId: state.championId,
        fromSig: state.sig,
        toSig: 200,
      });
    }

    // Ascend: only for ascendable champions
    if (champion.ascendable) {
      if (state.ascension === 'A0') {
        moves.push({
          kind: 'ascend',
          championId: state.championId,
          fromAscension: 'A0',
          toAscension: 'A1',
        });
      } else if (state.ascension === 'A1') {
        moves.push({
          kind: 'ascend',
          championId: state.championId,
          fromAscension: 'A1',
          toAscension: 'A2',
        });
      }
    }
  }

  return moves;
}

/**
 * Apply a move to a roster, returning the new roster.
 * Pure function — does not mutate the input.
 */
export function applyMove(
  roster: ChampionState[],
  move: AtomicMove,
): ChampionState[] {
  return roster.map((state) => {
    if (state.championId !== move.championId) return state;

    switch (move.kind) {
      case 'rank-up':
        return { ...state, rank: move.toRank as Rank };
      case 'sig-up':
        return { ...state, sig: move.toSig };
      case 'ascend':
        return { ...state, ascension: move.toAscension };
    }
  });
}

/**
 * v5 deferral check: should this move be labelled "ascend first"?
 *
 * Rule (architecture-v5.md §8.3): if a champion is currently A0 and
 * ascendable, prefer ascending to ranking up. Not eliminated from the
 * recommendation list — just flagged so the user understands the
 * sequencing implication.
 */
function shouldDefer(
  move: AtomicMove,
  champion: Champion,
  state: ChampionState,
): 'ascend-first' | null {
  if (move.kind !== 'rank-up') return null;
  if (!champion.ascendable) return null;
  if (state.ascension !== 'A0') return null;
  return 'ascend-first';
}

/**
 * Score every available move by its impact on top-30 champion prestige,
 * attach cost gates and advisory flags, and return the top N (default 10).
 *
 * Algorithm:
 * 1. Compute current prestige and top-30 cutoff
 * 2. For each enumerated move, simulate, compute new prestige
 * 3. Score = new prestige − current prestige
 * 4. Attach cost gates per §20 and deferral / state-persistence flags
 * 5. Sort by score descending, return top N
 *
 * The deferral flag does NOT depress the score — the user might still want
 * to take a deferrable move (stale catalysts, no faith in pull luck, etc.).
 * The UI should surface deferrable moves separately or with clear labels.
 */
export function optimise(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
  topN = 10,
): ScoredMove[] {
  const currentPrestige = calculateChampionPrestige(roster, championLookup);
  const moves = enumerateMoves(roster, championLookup);

  const scored: ScoredMove[] = moves.map((move) => {
    const champion = championLookup.get(move.championId);
    if (!champion) {
      throw new Error(`Champion not found in lookup: ${move.championId}`);
    }
    const stateBefore = roster.find((s) => s.championId === move.championId);
    if (!stateBefore) {
      throw new Error(`Roster state not found for: ${move.championId}`);
    }

    const beforeBHR = calculateBHR(champion, stateBefore);
    const newRoster = applyMove(roster, move);
    const stateAfter = newRoster.find((s) => s.championId === move.championId)!;
    const afterBHR = calculateBHR(champion, stateAfter);

    const newPrestige = calculateChampionPrestige(newRoster, championLookup);
    const top30Delta = newPrestige - currentPrestige;

    return {
      move,
      championName: champion.name,
      championClass: champion.class,
      beforeBHR,
      afterBHR,
      top30Delta,
      costGates: costGatesFor(move, champion),
      deferRecommendation: shouldDefer(move, champion, stateBefore),
      statePersistenceNote: statePersistenceNoteFor(move, champion, stateBefore),
    };
  });

  // Sort by delta descending; ties broken by move kind preference (rank-up > ascend > sig-up)
  // and then by champion name for stable ordering
  return scored
    .sort((a, b) => {
      if (b.top30Delta !== a.top30Delta) return b.top30Delta - a.top30Delta;
      const kindOrder = { 'rank-up': 0, ascend: 1, 'sig-up': 2 } as const;
      const ak = kindOrder[a.move.kind];
      const bk = kindOrder[b.move.kind];
      if (ak !== bk) return ak - bk;
      return a.championName.localeCompare(b.championName);
    })
    .slice(0, topN);
}
