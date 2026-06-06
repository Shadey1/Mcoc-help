import type {
  Level,
  Rank,
  RelicInventory,
  RelicState,
  ScoredRelicMove,
  StarTier,
} from './types';
import {
  specialRelicBHR,
  specialRelicCeiling,
  standardStatcastBHR,
  standardStatcastCeiling,
} from './prestige';
import {
  battlecast6Rating,
  type Battlecast6Id,
} from '../battlecast.js';
import {
  relicRating as r6StatcastRating,
  type LevelBracket as R6Sig,
  type RelicRank as R6Rank,
} from '../relic.js';

/**
 * Optional user-supplied overrides for 6★ relic values. Callback-based so
 * the engine stays ignorant of how the web app stores them. Return
 * `undefined` to fall through to the curve / catalogue.
 */
export type RelicOverrides = {
  statcast6?: (rank: R6Rank, sig: R6Sig) => number | undefined;
  battlecast6?: (id: string, rank: R6Rank, sig: R6Sig) => number | undefined;
};

/**
 * Enumerate the atomic moves available on the inventory.
 *
 * Move kinds (six discriminated variants):
 *   - level-up: move from (rank, L) to (rank, L+20). Tracks starTier so the
 *     recommendations view can label "6★" vs "7★".
 *   - rank-up: only surfaced when at L200; delta = (newRank ceiling − current).
 *   - special-level-up / special-rank-up: 7★ Cosmic Egg.
 *   - battlecast6-level-up / battlecast6-rank-up: each individually-tracked
 *     6★ battlecast.
 *
 * Moves whose afterBHR is below `top30Cutoff` are filtered out (they won't
 * affect total prestige).
 */
export function enumerateRelicMoves(
  inventory: RelicInventory,
  top30Cutoff: number,
  overrides?: RelicOverrides,
): ScoredRelicMove[] {
  const moves: ScoredRelicMove[] = [];

  for (const entry of inventory.standardCounts) {
    if (entry.count <= 0) continue;
    const from: RelicState = { rank: entry.rank, level: entry.level };
    const beforeBHR = statcastBHRForTier(entry.starTier, from, overrides);
    if (beforeBHR === null) continue;

    if (entry.level < 200) {
      const toLevel = (entry.level + 20) as Level;
      const afterBHR = statcastBHRForTier(
        entry.starTier,
        { rank: entry.rank, level: toLevel },
        overrides,
      );
      if (afterBHR !== null && afterBHR > top30Cutoff) {
        moves.push({
          move: {
            kind: 'level-up',
            starTier: entry.starTier,
            from,
            toLevel,
          },
          beforeBHR,
          afterBHR,
          delta: afterBHR - beforeBHR,
        });
      }
    }

    if (entry.level === 200 && entry.rank < 6) {
      const toRank = (entry.rank + 1) as Rank;
      const ceiling = statcastCeilingForTier(entry.starTier, toRank, overrides);
      if (ceiling !== null && ceiling > top30Cutoff) {
        moves.push({
          move: { kind: 'rank-up', starTier: entry.starTier, from, toRank },
          beforeBHR,
          afterBHR: ceiling,
          delta: ceiling - beforeBHR,
          notes: ['Relic resets to L0 immediately; ceiling realised after re-levelling.'],
        });
      }
    }
  }

  // 7★ specials — tracked individually.
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

  // 6★ battlecasts — tracked individually.
  for (const bc of inventory.battlecasts6Star) {
    const from: RelicState = { rank: bc.rank, level: bc.level };
    const beforeBHR = battlecast6BHR(bc.id, from, overrides);
    if (beforeBHR === null) continue;

    if (bc.level < 200) {
      const toLevel = bc.level + 20;
      const afterBHR = battlecast6BHR(
        bc.id,
        { rank: bc.rank, level: toLevel },
        overrides,
      );
      if (afterBHR !== null && afterBHR > top30Cutoff) {
        moves.push({
          move: { kind: 'battlecast6-level-up', id: bc.id, from, toLevel },
          beforeBHR,
          afterBHR,
          delta: afterBHR - beforeBHR,
        });
      }
    }

    if (bc.level === 200 && bc.rank < 5) {
      // 6★ battlecasts max out at R5 (R6 only exists for 7★).
      const toRank = (bc.rank + 1) as Rank;
      const ceiling = battlecast6Ceiling(bc.id, toRank, overrides);
      if (ceiling !== null && ceiling > top30Cutoff) {
        moves.push({
          move: { kind: 'battlecast6-rank-up', id: bc.id, from, toRank },
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
export function relicBHRs(
  inventory: RelicInventory,
  overrides?: RelicOverrides,
): number[] {
  const bhrs: number[] = [];

  for (const entry of inventory.standardCounts) {
    if (entry.count <= 0) continue;
    const bhr = statcastBHRForTier(
      entry.starTier,
      { rank: entry.rank, level: entry.level },
      overrides,
    );
    if (bhr === null) continue;
    for (let i = 0; i < entry.count; i++) bhrs.push(bhr);
  }

  for (const special of inventory.specials) {
    const bhr = specialRelicBHR(special.id, { rank: special.rank, level: special.level });
    if (bhr !== null) bhrs.push(bhr);
  }

  for (const bc of inventory.battlecasts6Star) {
    const bhr = battlecast6BHR(
      bc.id,
      { rank: bc.rank, level: bc.level },
      overrides,
    );
    if (bhr !== null) bhrs.push(bhr);
  }

  return bhrs.sort((a, b) => b - a);
}

/** Top-30 average BHR from the relic inventory. */
export function relicTop30Average(
  inventory: RelicInventory,
  overrides?: RelicOverrides,
): number {
  const bhrs = relicBHRs(inventory, overrides);
  if (bhrs.length === 0) return 0;
  const top = bhrs.slice(0, 30);
  const sum = top.reduce((a, b) => a + b, 0);
  return Math.round(sum / top.length);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Standard statcast BHR routed by tier. User overrides apply only to 6★
 *  (7★ has verified curves). The 6★ source can return an alpha estimate
 *  — we honour it (better than null), and the UI handles the "this
 *  contributes via an α value" framing separately. */
function statcastBHRForTier(
  starTier: StarTier,
  state: RelicState,
  overrides?: RelicOverrides,
): number | null {
  if (starTier === 7) return standardStatcastBHR(state);
  const r = tryToR6(state);
  if (!r) return null;
  const override = overrides?.statcast6?.(r.rank, r.sig);
  if (override !== undefined) return override;
  return r6StatcastRating(r.rank, r.sig).rating;
}

/** Ceiling at (rank, L200) for a tier's standard statcast. */
function statcastCeilingForTier(
  starTier: StarTier,
  rank: Rank,
  overrides?: RelicOverrides,
): number | null {
  if (starTier === 7) return standardStatcastCeiling(rank);
  if (rank < 1 || rank > 5) return null;
  const r6Rank = `R${rank}` as R6Rank;
  const override = overrides?.statcast6?.(r6Rank, 200);
  if (override !== undefined) return override;
  return r6StatcastRating(r6Rank, 200).rating;
}

/** 6★ battlecast BHR. Returns null when no data is available for the
 *  exact (id, rank, sig) state — bad ids or uncaptured states fall through
 *  to null, which the move enumerator handles as "no move available".
 *  Overrides apply per (id, rank, sig). */
function battlecast6BHR(
  id: string,
  state: RelicState,
  overrides?: RelicOverrides,
): number | null {
  const r = tryToR6(state);
  if (!r) return null;
  const override = overrides?.battlecast6?.(id, r.rank, r.sig);
  if (override !== undefined) return override;
  const result = battlecast6Rating(id as Battlecast6Id, r.rank, r.sig);
  return result ? result.rating : null;
}

/** 6★ battlecast ceiling at (rank, L200). */
function battlecast6Ceiling(
  id: string,
  rank: Rank,
  overrides?: RelicOverrides,
): number | null {
  if (rank < 1 || rank > 5) return null;
  const r6Rank = `R${rank}` as R6Rank;
  const override = overrides?.battlecast6?.(id, r6Rank, 200);
  if (override !== undefined) return override;
  const result = battlecast6Rating(id as Battlecast6Id, r6Rank, 200);
  return result ? result.rating : null;
}

/** Convert the 7★-side (Rank, Level) into the 6★-side (R6Rank, R6Sig).
 *  Returns null when rank is 6 (6★ side maxes at R5). The level type is
 *  identical between the two modules so just a cast. */
function tryToR6(
  state: RelicState,
): { rank: R6Rank; sig: R6Sig } | null {
  if (state.rank < 1 || state.rank > 5) return null;
  return {
    rank: `R${state.rank}` as R6Rank,
    sig: state.level as R6Sig,
  };
}
