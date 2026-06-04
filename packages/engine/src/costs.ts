import type { AtomicMove, Champion, ChampionState, CostGate } from './types.js';

/**
 * Derive the cost gates for an atomic move. Each move can have multiple
 * gates — e.g. an A0→A1 ascension on Pavitr requires A1 cluster materials,
 * and a R4→R5 rank-up on Maestro requires T6B + T3A Cosmic catalysts.
 *
 * 7-star class sig stones go 1:1 with sig levels — each stone applied
 * equals one sig level gained. Sig 20→200 = 180 stones, exact.
 */
export function costGatesFor(move: AtomicMove, champion: Champion): CostGate[] {
  switch (move.kind) {
    case 'rank-up':
      return [
        {
          kind: 'rank-cats',
          label: `Rank ${move.fromRank}→${move.toRank}: T6B + T3A ${champion.class}`,
          championClass: champion.class,
        },
      ];

    case 'sig-up': {
      const stones = sigStonesNeeded(move.fromSig, move.toSig);
      return [
        {
          kind: 'sig-stones',
          label: `Sig ${move.fromSig}→${move.toSig}: ${stones} ${champion.class} sig stones`,
          championClass: champion.class,
        },
      ];
    }

    case 'ascend':
      return [
        {
          kind: 'ascension',
          label: `Ascend ${move.fromAscension}→${move.toAscension}: ${move.toAscension} cluster — pulls req'd`,
        },
      ];
  }
}

/** Sig stones needed to go from sig X to sig Y. 1:1 — each stone gives +1 sig. */
function sigStonesNeeded(fromSig: number, toSig: number): number {
  return Math.max(0, toSig - fromSig);
}

/**
 * Annotate a move with its state-persistence note, if applicable.
 *
 * State-persistence is the v5 advisory flag: some moves commit the player
 * to a state they may want to revisit (e.g. ranking up Pavitr at A1 when
 * A2 materials might drop next month). Not a cost gate — a soft factor.
 */
export function statePersistenceNoteFor(
  move: AtomicMove,
  champion: Champion,
  state: ChampionState,
): string | null {
  // Only ascendable champions below max ascension
  if (!champion.ascendable) return null;
  if (state.ascension === 'A2') return null;

  // Only rank-up or sig-up moves (ascend is its own thing)
  if (move.kind === 'ascend') return null;

  return 'Fully captures current ceiling; further ascension still possible';
}
