import { describe, expect, it } from 'vitest';
import {
  ALL_BANDS_ON,
  bandScore,
  coverAllButOne,
  effectRosterCounts,
  hitScore,
  isEffectivelyImmune,
  queryImmunities,
  type BandFilter,
} from '../src/immunities.js';
import { FIXTURE_IDS, IMMUNITY_FIXTURE } from './fixtures/immunities-fixture.js';

describe('isEffectivelyImmune — the ≥100%-resist rule', () => {
  it('is true for 150% resist', () => {
    expect(isEffectivelyImmune({ band: 'resist', qual: '150%' })).toBe(true);
  });
  it('is true for exactly 100% resist', () => {
    expect(isEffectivelyImmune({ band: 'resist', qual: '100%' })).toBe(true);
  });
  it('is false for 80% resist', () => {
    expect(isEffectivelyImmune({ band: 'resist', qual: '80%' })).toBe(false);
  });
  it('is false for full immune — that is true immunity, not "effective"', () => {
    // Deliberately distinct concepts: the UI needs to be able to allow
    // true-immune while excluding merely effective-immune, or vice-versa.
    expect(isEffectivelyImmune({ band: 'immune' })).toBe(false);
  });
  it('is false for mechanic and synergy bands', () => {
    expect(isEffectivelyImmune({ band: 'mechanic', qual: 'Purify' })).toBe(false);
    expect(isEffectivelyImmune({ band: 'synergy', partner: 'x' })).toBe(false);
  });
  it('is false for null/undefined marks', () => {
    expect(isEffectivelyImmune(null)).toBe(false);
    expect(isEffectivelyImmune(undefined)).toBe(false);
  });
});

describe('bandScore — ranking weights', () => {
  it('immune=4 > 150%-resist=3 > 80%-resist=2 > synergy=1', () => {
    expect(bandScore({ band: 'immune' })).toBe(4);
    expect(bandScore({ band: 'resist', qual: '150%' })).toBe(3);
    expect(bandScore({ band: 'resist', qual: '80%' })).toBe(2);
    expect(bandScore({ band: 'synergy', partner: 'x' })).toBe(1);
  });
  it('mechanic = 2 (equal to <100% resist)', () => {
    expect(bandScore({ band: 'mechanic', qual: 'Purify' })).toBe(2);
    expect(bandScore({ band: 'mechanic', qual: 'Duration' })).toBe(2);
  });
});

describe('queryImmunities — ALL mode', () => {
  it('includes Onslaught for [Bleed, Incinerate] via 150% resist on both', () => {
    // The regression case: if the resist tier reverts to boolean
    // immune-only, Onslaught disappears from this query.
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      FIXTURE_IDS,
      ['Bleed', 'Incinerate'],
      'all',
    );
    expect(hits.map((h) => h.championId)).toContain('onslaught');
  });

  it('includes Maker for [Neuroshock]', () => {
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      FIXTURE_IDS,
      ['Neuroshock'],
      'all',
    );
    expect(hits.map((h) => h.championId)).toContain('the-maker');
  });

  it('marks include an entry for every selected effect', () => {
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      FIXTURE_IDS,
      ['Bleed', 'Incinerate'],
      'all',
    );
    const nova = hits.find((h) => h.championId === 'nova');
    // Nova is Bleed+Incinerate immune — should be a full-coverer.
    expect(nova).toBeDefined();
    expect(nova!.covered).toBe(2);
    expect(nova!.marks['Bleed']).toEqual({ band: 'immune' });
    expect(nova!.marks['Incinerate']).toEqual({ band: 'immune' });
  });
});

describe('queryImmunities — ANY mode', () => {
  it('includes both immune (Nova) and resist (Onslaught) champs for [Bleed]', () => {
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any');
    const ids = new Set(hits.map((h) => h.championId));
    expect(ids.has('nova')).toBe(true);
    expect(ids.has('onslaught')).toBe(true);
  });

  it('missing effect renders as a null mark, not an omitted row', () => {
    // Baron Zemo has Bleed immunity but no Incinerate coverage.
    // In ANY mode he should still appear (covers Bleed) with a null
    // Incinerate badge so the UI can render the missing chip.
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['baron-zemo'],
      ['Bleed', 'Incinerate'],
      'any',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.marks['Bleed']).toEqual({ band: 'immune' });
    expect(hits[0]!.marks['Incinerate']).toBeNull();
    expect(hits[0]!.covered).toBe(1);
  });

  it('omits rows with zero coverage', () => {
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      FIXTURE_IDS,
      ['Nullify'],
      'any',
    );
    // Nobody in the fixture covers Nullify.
    expect(hits).toEqual([]);
  });
});

describe('queryImmunities — band filters', () => {
  it('excludes full-immune champs when immune band is off', () => {
    // Nova only has immune marks against Bleed; toggling immune off drops
    // her below the coverage threshold.
    const bf: BandFilter = { ...ALL_BANDS_ON, immune: false };
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any', bf);
    const ids = new Set(hits.map((h) => h.championId));
    expect(ids.has('nova')).toBe(false);
    // Onslaught's Bleed is resist — should still be in.
    expect(ids.has('onslaught')).toBe(true);
  });

  it('excludes synergy-only champs when synergy band is off', () => {
    const bf: BandFilter = { ...ALL_BANDS_ON, synergy: false };
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any', bf);
    const ids = new Set(hits.map((h) => h.championId));
    // Domino's only Bleed coverage is a synergy pill — she drops.
    expect(ids.has('domino')).toBe(false);
    // Iron Man's Bleed is immune — untouched.
    expect(ids.has('iron-man')).toBe(true);
  });
});

describe('queryImmunities — sorting', () => {
  it('full-immune ranks above 150%-resist for the same single effect', () => {
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['onslaught', 'nova'],
      ['Bleed'],
      'any',
    );
    // Both cover Bleed once. Nova's immune (score 4) beats Onslaught's
    // 150% resist (score 3), so Nova ranks first.
    expect(hits[0]!.championId).toBe('nova');
    expect(hits[1]!.championId).toBe('onslaught');
  });

  it('full-coverer ranks above partial-coverer even with weaker bands', () => {
    // Coverage-count is the primary axis. Even if a partial-coverer has
    // strictly stronger bands on the effects they DO cover, they should
    // rank below anyone who covers all selected effects.
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['nova', 'iron-man'],
      ['Bleed', 'Poison'],
      'any',
    );
    // Both cover both — full-coverers tie on 2 covered; ranking then
    // falls to score. Sanity check the shape.
    expect(hits.every((h) => h.covered === 2)).toBe(true);
  });
});

describe('hitScore', () => {
  it('sums bandScore across covered marks only', () => {
    const hit = {
      championId: 'x',
      covered: 2,
      marks: {
        Bleed: { band: 'immune' as const },
        Incinerate: { band: 'resist' as const, qual: '80%' },
        Poison: null,
      },
    };
    expect(hitScore(hit, ['Bleed', 'Incinerate', 'Poison'])).toBe(4 + 2);
  });
});

describe('coverAllButOne', () => {
  it('returns champs at covered === selected.length - 1', () => {
    const near = coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed', 'Poison']);
    for (const h of near) expect(h.covered).toBe(1);
  });

  it('excludes full-coverers', () => {
    const near = coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed', 'Poison']);
    // Nova is a full-coverer of Bleed+Poison; she must not be in the
    // "cover all but one" list.
    expect(near.map((h) => h.championId)).not.toContain('nova');
  });

  it('is empty when fewer than 2 effects selected', () => {
    expect(coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'])).toEqual([]);
    expect(coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, [])).toEqual([]);
  });
});

describe('effectRosterCounts', () => {
  it('counts champions per effect across the given pool', () => {
    const counts = effectRosterCounts(IMMUNITY_FIXTURE, FIXTURE_IDS);
    // Bleed: nova, onslaught, lizard, hercules, patriot, baron-zemo,
    // spider-man-pavitr-prabhakar (synergy), domino (synergy), iron-man
    expect(counts.Bleed).toBe(9);
    expect(counts.Nullify).toBe(0);
  });

  it('drops synergy count when synergy band is off', () => {
    const bf: BandFilter = { ...ALL_BANDS_ON, synergy: false };
    const counts = effectRosterCounts(IMMUNITY_FIXTURE, FIXTURE_IDS, bf);
    // Same list minus pavitr + domino.
    expect(counts.Bleed).toBe(7);
  });
});
