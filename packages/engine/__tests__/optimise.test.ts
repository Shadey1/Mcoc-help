import { describe, expect, it } from 'vitest';
import {
  optimise,
  type Champion,
  type ChampionState,
} from '../src/index.js';

// Test fixture builders

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
    prestige: {
      rank5: { '0': rank5sig200 - 10500, '200': rank5sig200 },
    },
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

describe('optimise — top recommendation matches Phase 0 expected output', () => {
  it("Maestro R4→R5 leads the recommendations on Dave's verified roster", () => {
    const champions = [
      champ('lizard', 'Lizard', 'Science', 39760, true),
      champ('patriot', 'Patriot', 'Skill', 39460, true),
      champ('high-evolutionary', 'High Evolutionary', 'Science', 40600, true),
      champ('maestro', 'Maestro', 'Cosmic', 39420, true),
      champ('nova', 'Nova', 'Cosmic', 39360, true),
      champ('deadpool', 'Deadpool', 'Mutant', 37980, true),
      champ('iim', 'Iron Man (Infamous)', 'Tech', 40390, true),
      // Pad to 30 with non-ascendable champions at varying BHRs to make a realistic top-30
      ...Array.from({ length: 23 }, (_, i) =>
        champ(`filler-${i}`, `Filler ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('lizard', 5, 200, 'A2'),
      state('patriot', 5, 200, 'A2'),
      state('high-evolutionary', 5, 200, 'A0'),
      state('maestro', 4, 200, 'A2'),
      state('nova', 4, 200, 'A2'),
      state('deadpool', 4, 200, 'A2'),
      state('iim', 4, 200, 'A1'),
      ...Array.from({ length: 23 }, (_, i) => state(`filler-${i}`, 4, 200, 'A0')),
    ];

    const results = optimise(roster, lookup, 5);

    expect(results.length).toBeGreaterThan(0);
    // Top recommendation should be a rank-up
    expect(results[0]!.move.kind).toBe('rank-up');
    // And the delta should be positive (we're improving prestige)
    expect(results[0]!.top30Delta).toBeGreaterThan(0);
  });
});

describe('optimise — v5 deferral logic', () => {
  it('flags R4→R5 on ascendable A0 champion as ascend-first', () => {
    // Construct a roster where Baron Zemo (ascendable, A0) is in top-30 at R4
    const champions = [
      champ('zemo', 'Baron Zemo', 'Skill', 40150, true),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`other-${i}`, `Other ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('zemo', 4, 200, 'A0'),
      ...Array.from({ length: 29 }, (_, i) =>
        state(`other-${i}`, 4, 200, 'A0'),
      ),
    ];

    const results = optimise(roster, lookup, 30);
    const zemoRankUp = results.find(
      (r) => r.move.championId === 'zemo' && r.move.kind === 'rank-up',
    );
    expect(zemoRankUp).toBeDefined();
    expect(zemoRankUp!.deferRecommendation).toBe('ascend-first');
  });

  it('does NOT flag R4→R5 on a non-ascendable A0 champion', () => {
    const champions = [
      champ('onslaught', 'Onslaught', 'Mutant', 40580, false),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`other-${i}`, `Other ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('onslaught', 4, 200, 'A0'),
      ...Array.from({ length: 29 }, (_, i) =>
        state(`other-${i}`, 4, 200, 'A0'),
      ),
    ];

    const results = optimise(roster, lookup, 30);
    const onslaughtRankUp = results.find(
      (r) => r.move.championId === 'onslaught' && r.move.kind === 'rank-up',
    );
    expect(onslaughtRankUp).toBeDefined();
    expect(onslaughtRankUp!.deferRecommendation).toBeNull();
  });

  it('does NOT flag R4→R5 on an ascendable A1 champion', () => {
    // A1 champion can rank up without losing future ascension value
    const champions = [
      champ('iim', 'Iron Man (Infamous)', 'Tech', 40390, true),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`other-${i}`, `Other ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('iim', 4, 200, 'A1'),
      ...Array.from({ length: 29 }, (_, i) =>
        state(`other-${i}`, 4, 200, 'A0'),
      ),
    ];

    const results = optimise(roster, lookup, 30);
    const iimRankUp = results.find(
      (r) => r.move.championId === 'iim' && r.move.kind === 'rank-up',
    );
    expect(iimRankUp).toBeDefined();
    expect(iimRankUp!.deferRecommendation).toBeNull();
  });
});

describe('optimise — cost gates attached to every move', () => {
  it('rank-up move includes rank-cats cost gate', () => {
    const champions = [
      champ('maestro', 'Maestro', 'Cosmic', 39420, true),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`other-${i}`, `Other ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('maestro', 4, 200, 'A2'),
      ...Array.from({ length: 29 }, (_, i) =>
        state(`other-${i}`, 4, 200, 'A0'),
      ),
    ];

    const results = optimise(roster, lookup, 30);
    const maestroRankUp = results.find(
      (r) => r.move.championId === 'maestro' && r.move.kind === 'rank-up',
    );
    expect(maestroRankUp).toBeDefined();
    expect(maestroRankUp!.costGates.length).toBeGreaterThan(0);
    expect(maestroRankUp!.costGates[0]!.kind).toBe('rank-cats');
    expect(maestroRankUp!.costGates[0]!.label).toMatch(/Cosmic/);
  });

  it('sig-up move includes sig-stones cost gate', () => {
    const champions = [
      champ('pavitr', 'Spider-Man (Pavitr)', 'Mystic', 40290, true),
      ...Array.from({ length: 29 }, (_, i) =>
        champ(`other-${i}`, `Other ${i}`, 'Science', 39000 - i * 100, false),
      ),
    ];
    const lookup = new Map(champions.map((c) => [c.id, c]));

    const roster: ChampionState[] = [
      state('pavitr', 4, 100, 'A1'), // mid-sig — will have a sig-up move
      ...Array.from({ length: 29 }, (_, i) =>
        state(`other-${i}`, 4, 200, 'A0'),
      ),
    ];

    const results = optimise(roster, lookup, 200);
    const pavitrSigUp = results.find(
      (r) => r.move.championId === 'pavitr' && r.move.kind === 'sig-up',
    );
    expect(pavitrSigUp).toBeDefined();
    expect(pavitrSigUp!.costGates[0]!.kind).toBe('sig-stones');
  });
});
