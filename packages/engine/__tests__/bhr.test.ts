import { describe, expect, it } from 'vitest';
import {
  calculateBHR,
  calculateCeilingBHR,
  type Champion,
  type ChampionState,
} from '../src/index.js';

// Test fixtures drawn from §16 verified data points in architecture-v5.md.
// These are real values from Dave's in-game roster, captured 2026-05-06.

function makeChampion(
  overrides: Partial<Champion> & {
    id: string;
    name: string;
    class: Champion['class'];
    rank5: { sig0: number; sig200: number };
  },
): Champion {
  return {
    id: overrides.id,
    name: overrides.name,
    class: overrides.class,
    ascendable: overrides.ascendable ?? false,
    prestige: {
      rank5: { '0': overrides.rank5.sig0, '200': overrides.rank5.sig200 },
      rank4: overrides.prestige?.rank4,
      rank3: overrides.prestige?.rank3,
    },
    sigCurve: overrides.sigCurve ?? null,
    tags: overrides.tags ?? [],
  };
}

describe('calculateBHR — top of Dave\'s roster (§16 ground truth)', () => {
  it('Lizard R5 sig 200 A2 = 46,120', () => {
    const lizard = makeChampion({
      id: 'lizard',
      name: 'Lizard',
      class: 'Science',
      rank5: { sig0: 29120, sig200: 39760 },
      ascendable: true,
    });
    const state: ChampionState = {
      championId: 'lizard',
      rank: 5,
      sig: 200,
      ascension: 'A2',
    };
    // 39760 × 1.16 = 46121.6 → rounds to 46120
    expect(calculateBHR(lizard, state)).toBe(46120);
  });

  it('Patriot R5 sig 200 A2 = 45,770', () => {
    const patriot = makeChampion({
      id: 'patriot',
      name: 'Patriot',
      class: 'Skill',
      rank5: { sig0: 29570, sig200: 39460 },
      ascendable: true,
    });
    const state: ChampionState = {
      championId: 'patriot',
      rank: 5,
      sig: 200,
      ascension: 'A2',
    };
    // 39460 × 1.16 = 45773.6 → rounds to 45770
    expect(calculateBHR(patriot, state)).toBe(45770);
  });

  it('High Evolutionary R5 sig 200 A0 = 40,600', () => {
    const he = makeChampion({
      id: 'high-evolutionary',
      name: 'High Evolutionary',
      class: 'Science',
      rank5: { sig0: 30000, sig200: 40600 },
      ascendable: true,
    });
    const state: ChampionState = {
      championId: 'high-evolutionary',
      rank: 5,
      sig: 200,
      ascension: 'A0',
    };
    expect(calculateBHR(he, state)).toBe(40600);
  });

  it('Maestro R4 sig 200 A2 = 38,550', () => {
    const maestro = makeChampion({
      id: 'maestro',
      name: 'Maestro',
      class: 'Cosmic',
      rank5: { sig0: 27560, sig200: 39420 },
      ascendable: true,
    });
    const state: ChampionState = {
      championId: 'maestro',
      rank: 4,
      sig: 200,
      ascension: 'A2',
    };
    // 39420 × 0.8431 × 1.16 = 38559.7 — game shows 38550 (rounded to 10)
    const bhr = calculateBHR(maestro, state);
    expect(bhr).toBeGreaterThanOrEqual(38540);
    expect(bhr).toBeLessThanOrEqual(38560);
  });

  it('IIM R4 sig 200 A1 = 36,780', () => {
    const iim = makeChampion({
      id: 'iron-man-infamous',
      name: 'Iron Man (Infamous)',
      class: 'Tech',
      rank5: { sig0: 30070, sig200: 40390 },
      ascendable: true,
    });
    const state: ChampionState = {
      championId: 'iron-man-infamous',
      rank: 4,
      sig: 200,
      ascension: 'A1',
    };
    // 40390 × 0.8431 × 1.08 = 36780.0 — exact match
    expect(calculateBHR(iim, state)).toBe(36780);
  });

  it('Imperiosa R4 sig 200 A0 = 33,470 (top-30 cutoff)', () => {
    const imperiosa = makeChampion({
      id: 'imperiosa',
      name: 'Imperiosa',
      class: 'Cosmic',
      rank5: { sig0: 28850, sig200: 39700 },
      ascendable: false,
    });
    const state: ChampionState = {
      championId: 'imperiosa',
      rank: 4,
      sig: 200,
      ascension: 'A0',
    };
    // 39700 × 0.8431 = 33471.07 → rounds to 33470
    expect(calculateBHR(imperiosa, state)).toBe(33470);
  });
});

describe('calculateBHR — R3 multiplier (newly locked in v5)', () => {
  it('Onslaught R3 sig 200 A0 = 28,030 (from auntm.ai)', () => {
    const onslaught = makeChampion({
      id: 'onslaught',
      name: 'Onslaught',
      class: 'Mutant',
      rank5: { sig0: 30330, sig200: 40580 },
      ascendable: false,
    });
    const state: ChampionState = {
      championId: 'onslaught',
      rank: 3,
      sig: 200,
      ascension: 'A0',
    };
    // 40580 × 0.6906 = 28024.5 → rounds to 28020
    // auntm.ai reports 28024 for this exact state
    const bhr = calculateBHR(onslaught, state);
    expect(bhr).toBeGreaterThanOrEqual(28000);
    expect(bhr).toBeLessThanOrEqual(28030);
  });
});

describe('calculateBHR — intermediate sig levels use the curve', () => {
  it('Onslaught R5 sig 100 should land near auntm.ai\'s reported value', () => {
    // From auntm.ai R5 reference: Onslaught sig 100 = 36,911
    // Sig fraction at 100 from rank5 curve = 0.65
    // BHR = 30330 + (40580 − 30330) × 0.65 = 30330 + 6663 = 36993
    // Within ~100 of auntm — close enough for v1 with rank-default curve
    const onslaught = makeChampion({
      id: 'onslaught',
      name: 'Onslaught',
      class: 'Mutant',
      rank5: { sig0: 30330, sig200: 40580 },
    });
    const bhr = calculateBHR(onslaught, {
      championId: 'onslaught',
      rank: 5,
      sig: 100,
      ascension: 'A0',
    });
    // Tolerance: ±100 BHR — sig curve is rank-default approximation
    expect(bhr).toBeGreaterThanOrEqual(36800);
    expect(bhr).toBeLessThanOrEqual(37100);
  });
});

describe('calculateCeilingBHR — max obtainable BHR for ceiling view', () => {
  it('returns R5 sig 200 A2 for ascendable champions', () => {
    const heroEvol = makeChampion({
      id: 'high-evolutionary',
      name: 'High Evolutionary',
      class: 'Science',
      rank5: { sig0: 30000, sig200: 40600 },
      ascendable: true,
    });
    // 40600 × 1.16 = 47096 → rounds to 47100 (matches mcoc.gg ranking #1)
    expect(calculateCeilingBHR(heroEvol)).toBe(47100);
  });

  it('returns R5 sig 200 A0 for non-ascendable champions', () => {
    const onslaught = makeChampion({
      id: 'onslaught',
      name: 'Onslaught',
      class: 'Mutant',
      rank5: { sig0: 30330, sig200: 40580 },
      ascendable: false,
    });
    // Non-ascendable: ceiling = R5 sig 200 base, no A2 multiplier
    expect(calculateCeilingBHR(onslaught)).toBe(40580);
  });
});

describe('calculateBHR — error handling', () => {
  it('throws if champion id mismatches state', () => {
    const champion = makeChampion({
      id: 'lizard',
      name: 'Lizard',
      class: 'Science',
      rank5: { sig0: 29120, sig200: 39760 },
    });
    expect(() =>
      calculateBHR(champion, {
        championId: 'patriot',
        rank: 5,
        sig: 200,
        ascension: 'A0',
      }),
    ).toThrow(/Champion mismatch/);
  });

  it('throws for R2 (out of scope)', () => {
    const champion = makeChampion({
      id: 'lizard',
      name: 'Lizard',
      class: 'Science',
      rank5: { sig0: 29120, sig200: 39760 },
    });
    expect(() =>
      calculateBHR(champion, {
        championId: 'lizard',
        rank: 2,
        sig: 0,
        ascension: 'A0',
      }),
    ).toThrow(/Rank 2/);
  });
});
