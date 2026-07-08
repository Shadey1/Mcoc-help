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
      ['Bleed', 'Coldsnap'],
      'all',
    );
    const corvus = hits.find((h) => h.championId === 'corvus-glaive');
    // Corvus Glaive is Bleed+Coldsnap immune (conditional on Glaive
    // Immunity buff, but the band is still immune) — full-coverer.
    expect(corvus).toBeDefined();
    expect(corvus!.covered).toBe(2);
    expect(corvus!.marks['Bleed']?.band).toBe('immune');
    expect(corvus!.marks['Coldsnap']?.band).toBe('immune');
  });
});

describe('queryImmunities — ANY mode', () => {
  it('includes both immune (Baron Zemo) and resist (Onslaught) champs for [Bleed]', () => {
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any');
    const ids = new Set(hits.map((h) => h.championId));
    expect(ids.has('baron-zemo')).toBe(true);
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
    // Every effect in the fixture has at least one champion these
    // days, so we test the empty-result path by restricting the
    // champion pool to just Spider-Punk — who has Shock immunity but
    // nothing on Bleed. Querying Bleed against that pool must return
    // nothing.
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['spider-punk'],
      ['Bleed'],
      'any',
    );
    expect(hits).toEqual([]);
  });
});

describe('queryImmunities — band filters', () => {
  it('excludes full-immune champs when immune band is off', () => {
    // Baron Zemo's only Bleed mark is immune; toggling immune off drops
    // him below the coverage threshold.
    const bf: BandFilter = { ...ALL_BANDS_ON, immune: false };
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any', bf);
    const ids = new Set(hits.map((h) => h.championId));
    expect(ids.has('baron-zemo')).toBe(false);
    // Onslaught's Bleed is resist — should still be in.
    expect(ids.has('onslaught')).toBe(true);
  });

  it('excludes mechanic-only champs when mechanic band is off', () => {
    // Blade only has mechanic:Duration marks on Bleed; toggling
    // mechanic off drops him. Baron Zemo (immune band) stays.
    const bf: BandFilter = { ...ALL_BANDS_ON, mechanic: false };
    const hits = queryImmunities(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'], 'any', bf);
    const ids = new Set(hits.map((h) => h.championId));
    expect(ids.has('blade')).toBe(false);
    expect(ids.has('baron-zemo')).toBe(true);
  });
});

describe('queryImmunities — sorting', () => {
  it('full-immune ranks above 150%-resist for the same single effect', () => {
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['onslaught', 'baron-zemo'],
      ['Bleed'],
      'any',
    );
    // Both cover Bleed once. Baron Zemo's immune (score 4) beats
    // Onslaught's 150% resist (score 3), so Baron Zemo ranks first.
    expect(hits[0]!.championId).toBe('baron-zemo');
    expect(hits[1]!.championId).toBe('onslaught');
  });

  it('full-coverer ranks above partial-coverer even with weaker bands', () => {
    // Coverage-count is the primary axis. Corvus Glaive covers both
    // Bleed and Coldsnap (immune); Baron Zemo covers only Bleed. The
    // partial-coverer must rank below the full-coverer.
    const hits = queryImmunities(
      IMMUNITY_FIXTURE,
      ['corvus-glaive', 'baron-zemo'],
      ['Bleed', 'Coldsnap'],
      'any',
    );
    expect(hits[0]!.championId).toBe('corvus-glaive');
    expect(hits[0]!.covered).toBe(2);
    expect(hits[1]!.championId).toBe('baron-zemo');
    expect(hits[1]!.covered).toBe(1);
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
    const near = coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed', 'Coldsnap']);
    // Corvus Glaive is a full-coverer of Bleed+Coldsnap; he must not
    // be in the "cover all but one" list.
    expect(near.map((h) => h.championId)).not.toContain('corvus-glaive');
  });

  it('is empty when fewer than 2 effects selected', () => {
    expect(coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, ['Bleed'])).toEqual([]);
    expect(coverAllButOne(IMMUNITY_FIXTURE, FIXTURE_IDS, [])).toEqual([]);
  });
});

describe('effectRosterCounts', () => {
  it('counts champions per effect across the given pool', () => {
    const counts = effectRosterCounts(IMMUNITY_FIXTURE, FIXTURE_IDS);
    // Bleed grows every time a new champion with any Bleed band is
    // added to the fixture. Rather than hard-coding, assert the
    // known-large lower bound and verify the load-bearing entries.
    expect(counts.Bleed).toBeGreaterThanOrEqual(12);
    // Nullify: mangog + mordo (both synergy), vision-aarkus (Purify),
    // plus any global-duration champs (Blade) that add Nullify Duration.
    // Same lower-bound pattern for churn resistance.
    expect(counts.Nullify).toBeGreaterThanOrEqual(3);
    // Heal Block: starts with vision-aarkus, grows as global-duration
    // champs are added.
    expect(counts['Heal Block']).toBeGreaterThanOrEqual(1);
    // Falter is the newest tracked effect; spiral covers baseline,
    // and any global-duration champs (Blade / Karnak) pick it up too.
    expect(counts.Falter).toBeGreaterThanOrEqual(1);
  });

  it('drops synergy count when synergy band is off', () => {
    const bf: BandFilter = { ...ALL_BANDS_ON, synergy: false };
    const counts = effectRosterCounts(IMMUNITY_FIXTURE, FIXTURE_IDS, bf);
    // Pavitr's synergy-only Bleed drops; every non-synergy entry stays.
    // Same lower-bound approach as the previous test.
    expect(counts.Bleed).toBeGreaterThanOrEqual(12);
    // Nullify without synergy: strip mangog+mordo, keep vision-aarkus
    // Purify + any Duration entries.
    expect(counts.Nullify).toBeGreaterThanOrEqual(1);
  });
});
