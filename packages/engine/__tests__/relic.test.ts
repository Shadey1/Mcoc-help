import { describe, expect, it } from 'vitest';
import { relicRating, RELIC_RANKS, LEVEL_BRACKETS } from '../src/relic.js';

/**
 * Relic prestige model — verified anchors and curve invariants.
 *
 * The 8 verified data points must always return isAlpha: false. Everything
 * else flows through the provisional alpha-fill curve and must return
 * isAlpha: true. The boundary equality (R1 L60 == R2 L0) and the
 * single-ladder principle are also tested explicitly.
 */

describe('relicRating — verified anchors (must be isAlpha: false)', () => {
  it('R1 L0 = 852', () => {
    expect(relicRating('R1', 0)).toEqual({ rating: 852, isAlpha: false });
  });
  it('R1 L20 = 1014', () => {
    expect(relicRating('R1', 20)).toEqual({ rating: 1014, isAlpha: false });
  });
  it('R1 L40 = 1068', () => {
    expect(relicRating('R1', 40)).toEqual({ rating: 1068, isAlpha: false });
  });
  it('R1 L60 = 1122', () => {
    expect(relicRating('R1', 60)).toEqual({ rating: 1122, isAlpha: false });
  });
  it('R2 L0 = 1122', () => {
    expect(relicRating('R2', 0)).toEqual({ rating: 1122, isAlpha: false });
  });
  it('R2 L20 = 1284', () => {
    expect(relicRating('R2', 20)).toEqual({ rating: 1284, isAlpha: false });
  });
  it('R3 L20 = 1554', () => {
    expect(relicRating('R3', 20)).toEqual({ rating: 1554, isAlpha: false });
  });
  it('R3 L40 = 1608', () => {
    expect(relicRating('R3', 40)).toEqual({ rating: 1608, isAlpha: false });
  });
});

describe('relicRating — seamless boundary R1→R2', () => {
  it('R1 L60 rating == R2 L0 rating (single-ladder confirmation)', () => {
    expect(relicRating('R1', 60).rating).toBe(relicRating('R2', 0).rating);
    expect(relicRating('R1', 60).rating).toBe(1122);
  });
});

describe('relicRating — alpha flag on un-captured states', () => {
  it('R2 L40 (mid-level gap inside a partially-verified rank) is alpha', () => {
    expect(relicRating('R2', 40).isAlpha).toBe(true);
  });

  it('R2 L60 (mid-level gap) is alpha', () => {
    expect(relicRating('R2', 60).isAlpha).toBe(true);
  });

  it('R3 L0 (gap on a verified rank) is alpha', () => {
    expect(relicRating('R3', 0).isAlpha).toBe(true);
  });

  it('R4 L0 (entirely uncaptured rank) is alpha', () => {
    expect(relicRating('R4', 0).isAlpha).toBe(true);
  });

  it('R5 L0 (entirely uncaptured rank) is alpha', () => {
    expect(relicRating('R5', 0).isAlpha).toBe(true);
  });

  it('R1 L80 (extrapolation past last verified level) is alpha', () => {
    expect(relicRating('R1', 80).isAlpha).toBe(true);
  });
});

describe('relicRating — provisional curve shape (within-rank +162 / +54)', () => {
  it('R2 L40 alpha-fills to 1338 (1284 + 54)', () => {
    // R2 L20 = 1284 verified; +54/bracket says L40 = 1338.
    expect(relicRating('R2', 40).rating).toBe(1338);
  });

  it('R2 L60 alpha-fills to 1392 (1338 + 54)', () => {
    expect(relicRating('R2', 60).rating).toBe(1392);
  });

  it('R3 L0 alpha-fills consistent with R3 L20 - 162', () => {
    // R3 L20 verified at 1554; +162 first-bracket rule says R3 L0 = 1392.
    // Also consistent with seamless from R2 L60 alpha (1392).
    expect(relicRating('R3', 0).rating).toBe(1392);
  });

  it('R4 L0 alpha-fills via R3 L60 seamless boundary', () => {
    // R3 L60 alpha = 1392 + 270 = 1662 (curve sum through L60).
    expect(relicRating('R4', 0).rating).toBe(1662);
  });
});

describe('relicRating — structural sanity', () => {
  it('every (rank, level) returns a finite positive rating', () => {
    for (const rank of RELIC_RANKS) {
      for (const level of LEVEL_BRACKETS) {
        const out = relicRating(rank, level);
        expect(Number.isFinite(out.rating)).toBe(true);
        expect(out.rating).toBeGreaterThan(0);
      }
    }
  });

  it('within each rank, alpha-fill is monotonically non-decreasing as level rises', () => {
    for (const rank of RELIC_RANKS) {
      let prev = -Infinity;
      for (const level of LEVEL_BRACKETS) {
        const r = relicRating(rank, level).rating;
        expect(r).toBeGreaterThanOrEqual(prev);
        prev = r;
      }
    }
  });
});
