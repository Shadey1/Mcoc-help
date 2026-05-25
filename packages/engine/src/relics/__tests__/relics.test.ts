import { describe, expect, it } from 'vitest';
import {
  specialRelicBHR,
  specialRelicCeiling,
  standardStatcastBHR,
  standardStatcastCeiling,
} from '../prestige';
import { enumerateRelicMoves, relicBHRs, relicTop30Average } from '../moves';

describe('standardStatcastBHR', () => {
  it('returns known R1 anchors exactly', () => {
    expect(standardStatcastBHR({ rank: 1, level: 0 })).toBe(1856);
    expect(standardStatcastBHR({ rank: 1, level: 60 })).toBe(2310);
    expect(standardStatcastBHR({ rank: 1, level: 200 })).toBe(2946);
  });

  it('returns known R2 anchors exactly', () => {
    expect(standardStatcastBHR({ rank: 2, level: 20 })).toBe(2583);
    expect(standardStatcastBHR({ rank: 2, level: 40 })).toBe(2674);
    expect(standardStatcastBHR({ rank: 2, level: 60 })).toBe(2764);
    expect(standardStatcastBHR({ rank: 2, level: 80 })).toBe(2855);
    expect(standardStatcastBHR({ rank: 2, level: 100 })).toBe(2946);
    expect(standardStatcastBHR({ rank: 2, level: 200 })).toBe(3400);
  });

  it('interpolates linearly between R2 L100 and R2 L200', () => {
    // L100 = 2946, L200 = 3400. Slope = (3400-2946)/100 = 4.54 per level.
    // L140 should be 2946 + 40 * 4.54 = 3128 (rounded).
    expect(standardStatcastBHR({ rank: 2, level: 140 })).toBe(3128);
  });

  it('clamps below the lowest known anchor', () => {
    // R2 has no L0 anchor; lowest is L20 = 2583. Asking for L0 returns L20's value.
    expect(standardStatcastBHR({ rank: 2, level: 0 })).toBe(2583);
  });

  it('returns null for unreachable ranks (R3+ unpopulated)', () => {
    expect(standardStatcastBHR({ rank: 3, level: 100 })).toBeNull();
    expect(standardStatcastBHR({ rank: 6, level: 0 })).toBeNull();
  });
});

describe('specialRelicBHR — Cosmic Egg', () => {
  it('returns known anchors exactly', () => {
    expect(specialRelicBHR('cosmic-egg', { rank: 2, level: 200 })).toBe(4084);
    expect(specialRelicBHR('cosmic-egg', { rank: 5, level: 0 })).toBe(3060);
  });

  it('returns null for ranks with no known anchors', () => {
    expect(specialRelicBHR('cosmic-egg', { rank: 1, level: 100 })).toBeNull();
    expect(specialRelicBHR('cosmic-egg', { rank: 3, level: 100 })).toBeNull();
  });
});

describe('ceiling lookups', () => {
  it('standardStatcastCeiling at R1 = 2946 (R1 L200)', () => {
    expect(standardStatcastCeiling(1)).toBe(2946);
  });

  it('standardStatcastCeiling at R2 = 3400 (R2 L200)', () => {
    expect(standardStatcastCeiling(2)).toBe(3400);
  });

  it('specialRelicCeiling for Cosmic Egg at R2 = 4084', () => {
    expect(specialRelicCeiling('cosmic-egg', 2)).toBe(4084);
  });
});

describe('enumerateRelicMoves', () => {
  it('surfaces a level-up with the expected delta', () => {
    const moves = enumerateRelicMoves(
      { standardCounts: [{ rank: 2, level: 60, count: 1 }], specials: [] },
      0,
    );
    const levelUp = moves.find((m) => m.move.kind === 'level-up');
    expect(levelUp).toBeDefined();
    expect(levelUp!.beforeBHR).toBe(2764);
    expect(levelUp!.afterBHR).toBe(2855);
    expect(levelUp!.delta).toBe(91);
  });

  it('surfaces a rank-up when at L200, with delta = ceiling gain', () => {
    const moves = enumerateRelicMoves(
      { standardCounts: [{ rank: 1, level: 200, count: 1 }], specials: [] },
      0,
    );
    const rankUp = moves.find((m) => m.move.kind === 'rank-up');
    expect(rankUp).toBeDefined();
    expect(rankUp!.beforeBHR).toBe(2946); // R1 L200
    expect(rankUp!.afterBHR).toBe(3400);  // R2 L200 ceiling
    expect(rankUp!.delta).toBe(454);
    expect(rankUp!.notes).toContain('Relic resets to L0 immediately; ceiling realised after re-levelling.');
  });

  it('does not surface a rank-up below L200', () => {
    const moves = enumerateRelicMoves(
      { standardCounts: [{ rank: 1, level: 100, count: 1 }], specials: [] },
      0,
    );
    expect(moves.some((m) => m.move.kind === 'rank-up')).toBe(false);
  });

  it('filters moves whose afterBHR is below the cutoff', () => {
    const moves = enumerateRelicMoves(
      { standardCounts: [{ rank: 1, level: 0, count: 1 }], specials: [] },
      10000, // impossibly high cutoff
    );
    expect(moves).toEqual([]);
  });

  it('sorts moves by delta descending', () => {
    const moves = enumerateRelicMoves(
      {
        standardCounts: [
          { rank: 1, level: 200, count: 1 }, // rank-up: delta 454
          { rank: 2, level: 60, count: 1 },  // level-up: delta 91
        ],
        specials: [],
      },
      0,
    );
    expect(moves[0].delta).toBe(454);
    expect(moves[1].delta).toBe(91);
  });

  it('handles specials alongside standards', () => {
    const moves = enumerateRelicMoves(
      {
        standardCounts: [],
        specials: [{ id: 'cosmic-egg', rank: 2, level: 200 }],
      },
      0,
    );
    // Cosmic Egg at R2 L200 should surface a rank-up... but R3 has no data, so
    // the move is filtered (null ceiling). At R5 we have L0 = 3060, but that's
    // skipping ranks. So no move surfaces.
    expect(moves).toEqual([]);
  });
});

describe('relicBHRs', () => {
  it('expands aggregated counts into individual BHRs', () => {
    const bhrs = relicBHRs({
      standardCounts: [
        { rank: 2, level: 200, count: 3 },
        { rank: 1, level: 0, count: 2 },
      ],
      specials: [{ id: 'cosmic-egg', rank: 2, level: 200 }],
    });
    // Sorted desc: cosmic-egg 4084, then 3x R2 L200 = 3400, then 2x R1 L0 = 1856
    expect(bhrs).toEqual([4084, 3400, 3400, 3400, 1856, 1856]);
  });

  it('skips zero-count entries', () => {
    const bhrs = relicBHRs({
      standardCounts: [{ rank: 2, level: 100, count: 0 }],
      specials: [],
    });
    expect(bhrs).toEqual([]);
  });
});

describe('relicTop30Average', () => {
  it('averages the top 30 from inventory', () => {
    const bhrs = relicTop30Average({
      standardCounts: [{ rank: 2, level: 200, count: 30 }],
      specials: [],
    });
    expect(bhrs).toBe(3400);
  });

  it('returns 0 on empty inventory', () => {
    expect(relicTop30Average({ standardCounts: [], specials: [] })).toBe(0);
  });

  it('caps at 30 when more relics exist', () => {
    // 30 at 3400, 5 at 1856 (below the cut). Top-30 avg = 3400.
    expect(
      relicTop30Average({
        standardCounts: [
          { rank: 2, level: 200, count: 30 },
          { rank: 1, level: 0, count: 5 },
        ],
        specials: [],
      }),
    ).toBe(3400);
  });
});
