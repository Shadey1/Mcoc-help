import { describe, expect, it } from 'vitest';
import seedData from '../../../data/champions/seed.json' with { type: 'json' };
import fixture from './fixtures/ascendable-roster.json' with { type: 'json' };
import type { Champion } from '../src/types.js';

// Dave's verified ascendable roster, captured 2026-06-29 from in-game BHR
// screenshots. Every entry is a champion that is ascendable, ascended, or
// ascension-ready on the account, with displayed BHR. This complements the
// §16 Phase 0 fixture (top-30 ground truth) — it is the canonical "who can
// ascend" set, and seed.json's ascendable flags must agree with it.
//
// The fixture lists names as they appear in-game. Several use bare names
// where seed.json carries a variant suffix (Storm → Storm (Pyramid X),
// Black Panther → Civil War, etc.). The resolver below encodes those
// known aliases explicitly; any new mismatch should be added here or
// fixed in seed, not silently coerced.

type FixtureEntry = { name: string; bhr: number; class: string };
type SeedChampion = Pick<Champion, 'id' | 'name' | 'class' | 'ascendable'>;

const NAME_ALIASES: Record<string, string> = {
  // Bare in-game name → seed variant name (only ascendable variant exists)
  'Storm': 'Storm (Pyramid X)',
  'Black Panther': 'Black Panther (Civil War)',
  'Abomination': 'Abomination (Immortal)',
  // Abbreviations / suffix differences
  'Infamous Iron Man': 'Iron Man (Infamous)',
  'Blade (Stellar)': 'Blade (Stellar Forged)',
  'Star-Lord (Stellar)': 'Star-Lord (Stellar Forged)',
  'Spider-Slayer (J. J. J.)': 'Spider-Slayer (J. Jonah Jameson)',
};

const champions = seedData.champions as SeedChampion[];
const byName = new Map(champions.map((c) => [c.name, c]));
const byNameLower = new Map(champions.map((c) => [c.name.toLowerCase(), c]));

function resolve(fixtureName: string): SeedChampion | null {
  const aliased = NAME_ALIASES[fixtureName] ?? fixtureName;
  return byName.get(aliased) ?? byNameLower.get(aliased.toLowerCase()) ?? null;
}

describe('ascendable-roster fixture — name resolution', () => {
  it('every fixture name resolves to a champion in seed.json', () => {
    const unresolved: string[] = [];
    for (const entry of fixture as FixtureEntry[]) {
      if (!resolve(entry.name)) unresolved.push(entry.name);
    }
    expect(unresolved, `unresolved names (add to NAME_ALIASES or fix seed): ${unresolved.join(', ')}`).toEqual([]);
  });

  it('has exactly 62 entries (fixture length lock)', () => {
    expect((fixture as FixtureEntry[]).length).toBe(62);
  });
});

describe('ascendable-roster fixture — class agreement with seed', () => {
  it('every fixture entry has matching class in seed.json', () => {
    const mismatches: string[] = [];
    for (const entry of fixture as FixtureEntry[]) {
      const seed = resolve(entry.name);
      if (!seed) continue;
      if (seed.class !== entry.class) {
        mismatches.push(`${entry.name}: fixture=${entry.class} seed=${seed.class} (id=${seed.id})`);
      }
    }
    expect(mismatches, `class mismatches: ${mismatches.join(' | ')}`).toEqual([]);
  });
});

describe('ascendable-roster fixture — seed.json ascendable flag agrees', () => {
  // This test is designed to fail loudly when seed.json marks a fixture
  // champion as non-ascendable. The fixture is ground truth for membership;
  // a failure here means seed needs a one-line ascendable: true flip, not
  // that the fixture is wrong.
  it('every fixture champion is marked ascendable in seed.json', () => {
    const notMarked: string[] = [];
    for (const entry of fixture as FixtureEntry[]) {
      const seed = resolve(entry.name);
      if (!seed) continue;
      if (!seed.ascendable) notMarked.push(`${entry.name} (id=${seed.id})`);
    }
    expect(notMarked, `seed says non-ascendable but fixture says ascendable — flip ascendable: true: ${notMarked.join(' | ')}`).toEqual([]);
  });
});

describe('ascendable-roster fixture — anchor values match §16 ground truth', () => {
  // Phase 0 ground-truth roster pins these same champs at the same BHRs.
  // If either side drifts, this catches it.
  it('Lizard BHR = 46,120 (matches §16)', () => {
    const lizard = (fixture as FixtureEntry[]).find((f) => f.name === 'Lizard');
    expect(lizard?.bhr).toBe(46120);
  });

  it('Patriot BHR = 45,770 (matches §16)', () => {
    const patriot = (fixture as FixtureEntry[]).find((f) => f.name === 'Patriot');
    expect(patriot?.bhr).toBe(45770);
  });
});
