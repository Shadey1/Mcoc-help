import type {
  Level,
  Rank,
  RelicInventory,
  RelicState,
  ScoredRelicMove,
} from './types';
import {
  specialRelicBHR,
  specialRelicCeiling,
  standardStatcastBHR,
  standardStatcastCeiling,
} from './prestige';

/**
 * Enumerate the atomic moves available on the inventory.
 *
 * Two move kinds:
 * - level-up: move from (rank, L) to (rank, L+20). Delta = positive.
 * - rank-up: only surfaced when at L200; delta = (newRank L200 BHR − current).
 *   We use the new rank's ceiling rather than the level-reset-to-0 BHR
 *   because the rank-up is an investment commitment — the user is choosing
 *   the new ceiling, accepting the temporary dip.
 *
 * Moves whose afterBHR is below `top30Cutoff` are filtered out (they won't
 * affect total prestige). Standard relics yield one move per distinct
 * (rank, level) bucket in inventory — the user picks which specific copy
 * to upgrade in-game.
 */
export function enumerateRelicMoves(
  inventory: RelicInventory,
  top30Cutoff: number,
): ScoredRelicMove[] {
  const moves: ScoredRelicMove[] = [];

  for (const entry of inventory.standardCounts) {
    if (entry.count <= 0) continue;
    const from: RelicState = { rank: entry.rank, level: entry.level };
    const beforeBHR = standardStatcastBHR(from);
    if (beforeBHR === null) continue;

    // Level-up
    if (entry.level < 200) {
      const toLevel = (entry.level + 20) as Level;
      const afterBHR = standardStatcastBHR({ rank: entry.rank, level: toLevel });
      if (afterBHR !== null && afterBHR > top30Cutoff) {
        moves.push({
          move: { kind: 'level-up', from, toLevel },
          beforeBHR,
          afterBHR,
          delta: afterBHR - beforeBHR,
        });
      }
    }

    // Rank-up (only when at L200; delta = new rank's ceiling)
    if (entry.level === 200 && entry.rank < 6) {
      const toRank = (entry.rank + 1) as Rank;
      const ceiling = standardStatcastCeiling(toRank);
      if (ceiling !== null && ceiling > top30Cutoff) {
        moves.push({
          move: { kind: 'rank-up', from, toRank },
          beforeBHR,
          afterBHR: ceiling,
          delta: ceiling - beforeBHR,
          notes: ['Relic resets to L0 immediately; ceiling realised after re-levelling.'],
        });
      }
    }
  }

  // Specials — same shape but tracked individually
  for (const special of inventory.specials) {
    const from: RelicState = { rank: special.rank, level: special.level };
    const beforeBHR = specialRelicBHR(special.id, from);
    if (beforeBHR === null) continue;

    if (special.level < 200) {
      const toLevel = (special.level + 20) as Level;
      const afterBHR = specialRelicBHR(special.id, { rank: special.rank, level: toLevel });
      if (afterBHR !== null && afterBHR > top30Cutoff) {
        moves.push({
          move: { kind: 'special-level-up', id: special.id, from, toLevel },
          beforeBHR,
          afterBHR,
          delta: afterBHR - beforeBHR,
        });
      }
    }

    if (special.level === 200 && special.rank < 6) {
      const toRank = (special.rank + 1) as Rank;
      const ceiling = specialRelicCeiling(special.id, toRank);
      if (ceiling !== null && ceiling > top30Cutoff) {
        moves.push({
          move: { kind: 'special-rank-up', id: special.id, from, toRank },
          beforeBHR,
          afterBHR: ceiling,
          delta: ceiling - beforeBHR,
          notes: ['Relic resets to L0 immediately; ceiling realised after re-levelling.'],
        });
      }
    }
  }

  return moves.sort((a, b) => b.delta - a.delta);
}

/**
 * Expand inventory into a sorted-descending array of individual relic BHRs.
 * Used for top-30 calculation — the recommendations view merges this with
 * champion BHRs to compute the combined top-30 average.
 */
export function relicBHRs(inventory: RelicInventory): number[] {
  const bhrs: number[] = [];

  for (const entry of inventory.standardCounts) {
    if (entry.count <= 0) continue;
    const bhr = standardStatcastBHR({ rank: entry.rank, level: entry.level });
    if (bhr === null) continue;
    for (let i = 0; i < entry.count; i++) bhrs.push(bhr);
  }

  for (const special of inventory.specials) {
    const bhr = specialRelicBHR(special.id, { rank: special.rank, level: special.level });
    if (bhr !== null) bhrs.push(bhr);
  }

  return bhrs.sort((a, b) => b - a);
}

/** Top-30 average BHR from the relic inventory. */
export function relicTop30Average(inventory: RelicInventory): number {
  const bhrs = relicBHRs(inventory);
  if (bhrs.length === 0) return 0;
  const top = bhrs.slice(0, 30);
  const sum = top.reduce((a, b) => a + b, 0);
  return Math.round(sum / top.length);
}
