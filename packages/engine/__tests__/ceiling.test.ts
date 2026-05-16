import { describe, expect, it } from 'vitest';
import {
  computeCeilings,
  type Champion,
  type ChampionState,
} from '../src/index.js';

function champ(
  id: string,
  name: string,
  klass: Champion['class'],
  rank5sig200: number,
  ascendable = false,
): Champion {
  return {
    id,
    name,
    class: klass,
    ascendable,
    prestige: { rank5: { '0': rank5sig200 - 10500, '200': rank5sig200 } },
    sigCurve: null,
    tags: [],
  };
}

function state(
  id: string,
  rank: 3 | 4 | 5,
  sig: number,
  ascension: 'A0' | 'A1' | 'A2',
): ChampionState {
  return { championId: id, rank, sig, ascension };
}

describe('computeCeilings — the long-term planning view', () => {
  it('surfaces Blue Marvel as a high-impact non-top-30 play (Phase 0 finding)', () => {
    // Blue Marvel sits outside Dave's top-30 at ~28k BHR but his ceiling
    // (R5 sig 200 A2) is 46,930 — should be a top investment target.
    const blueMarvel = champ('blue-marvel', 'Blue Marvel', 'Science', 40460, true);

    // Top-30 of 30 unascendable champions, all at R4 sig 200
    const top30Filler = Array.from({ length: 30 }, (_, i) =>
      champ(`top-${i}`, `Top ${i}`, 'Science', 39700 - i * 50, false),
    );

    const champions = [blueMarvel, ...top30Filler];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    // Blue Marvel at R3 sig 0 A0 (low development, currently outside top-30)
    // Top-30 filler all at R4 sig 200 A0 (so they're at ~33,400 BHR each)
    const roster: ChampionState[] = [
      state('blue-marvel', 3, 0, 'A0'),
      ...top30Filler.map((c) => state(c.id, 4, 200, 'A0')),
    ];

    const ceilings = computeCeilings(roster, lookup);
    const bm = ceilings.find((c) => c.championId === 'blue-marvel');
    expect(bm).toBeDefined();

    // Blue Marvel's ceiling = 40460 × 1.16 = 46934 → rounds to 46930
    expect(bm!.ceilingBHR).toBe(46930);

    // Not currently in top-30
    expect(bm!.inTop30).toBe(false);

    // But the prestige delta if maxed should be sizeable
    // (46930 − cutoff) / 30 ≈ +400+
    expect(bm!.prestigeDeltaIfMaxed).toBeGreaterThan(300);
  });

  it('non-ascendable champions cap at R5 sig 200 A0 ceiling', () => {
    const onslaught = champ('onslaught', 'Onslaught', 'Mutant', 40580, false);
    const fillers = Array.from({ length: 30 }, (_, i) =>
      champ(`f-${i}`, `F ${i}`, 'Science', 39000 - i * 50, false),
    );

    const champions = [onslaught, ...fillers];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('onslaught', 4, 200, 'A0'),
      ...fillers.map((c) => state(c.id, 4, 200, 'A0')),
    ];

    const ceilings = computeCeilings(roster, lookup);
    const ons = ceilings.find((c) => c.championId === 'onslaught');
    expect(ons).toBeDefined();
    expect(ons!.ascendable).toBe(false);
    expect(ons!.ceilingBHR).toBe(40580); // No A2 multiplier
  });

  it('sorts results by prestigeDeltaIfMaxed descending', () => {
    const champions = [
      champ('high-ceiling', 'High Ceiling', 'Science', 40600, true),
      champ('low-ceiling', 'Low Ceiling', 'Science', 37000, false),
      ...Array.from({ length: 28 }, (_, i) =>
        champ(`f-${i}`, `F ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));
    const roster: ChampionState[] = [
      state('high-ceiling', 3, 0, 'A0'),
      state('low-ceiling', 3, 0, 'A0'),
      ...Array.from({ length: 28 }, (_, i) => state(`f-${i}`, 4, 200, 'A0')),
    ];

    const ceilings = computeCeilings(roster, lookup);
    // High-ceiling should be ranked ahead of low-ceiling
    const highIdx = ceilings.findIndex((c) => c.championId === 'high-ceiling');
    const lowIdx = ceilings.findIndex((c) => c.championId === 'low-ceiling');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('marks champions in top-30 with inTop30: true', () => {
    const champions = [
      champ('lizard', 'Lizard', 'Science', 39760, true),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`f-${i}`, `F ${i}`, 'Science', 39000 - i * 50, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('lizard', 5, 200, 'A2'),
      ...Array.from({ length: 29 }, (_, i) => state(`f-${i}`, 4, 200, 'A0')),
    ];

    const ceilings = computeCeilings(roster, lookup);
    const lizard = ceilings.find((c) => c.championId === 'lizard');
    expect(lizard!.inTop30).toBe(true);
    // Lizard already at ceiling (R5 sig 200 A2) — headroom should be near 0
    expect(lizard!.headroomBHR).toBeLessThan(20);
  });
});
