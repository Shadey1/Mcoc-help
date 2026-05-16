import type { AtomicMove, Champion, ChampionState, CostGate } from './types.js';

/**
 * Derive the cost gates for an atomic move. Each move can have multiple
 * gates — e.g. an A0→A1 ascension on Pavitr requires A1 cluster materials,
 * and a R4→R5 rank-up on Maestro requires T6B + T3A Cosmic catalysts.
 *
 * Sig-stone cost is sized by the gap being closed (sig 0→200 needs more
 * stones than sig 100→200). Stones-per-bracket isn't a flat number in-game;
 * we use a reasonable approximation here and refine via observation.
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
      const stones = approxSigStonesNeeded(move.fromSig, move.toSig);
      return [
        {
          kind: 'sig-stones',
          label: `Sig ${move.fromSig}→${move.toSig}: ~${stones} ${champion.class} sig stones`,
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

/**
 * Rough estimate of sig stones required to go from sig X to sig Y.
 * Refined in Phase 2 from real cost tables; this is order-of-magnitude only.
 *
 * Approximate cost-per-level rises with sig, mirroring the in-game stone
 * requirement that escalates from sig 100 onward.
 */
function approxSigStonesNeeded(fromSig: number, toSig: number): number {
  let total = 0;
  for (let s = fromSig; s < toSig; s += 20) {
    // Rough cost ramp: cheap early, expensive late
    if (s < 60) total += 10;
    else if (s < 120) total += 20;
    else if (s < 160) total += 35;
    else total += 50;
  }
  return total;
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
