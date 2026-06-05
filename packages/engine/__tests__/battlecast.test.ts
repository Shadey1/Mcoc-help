import { describe, expect, it } from 'vitest';
import {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
  battlecast6Rating,
} from '../src/battlecast.js';

describe('battlecast6Rating — verified anchors', () => {
  it('cosmic-egg R5 sig 200 = 3060 (verified)', () => {
    expect(battlecast6Rating('cosmic-egg', 'R5', 200)).toEqual({
      rating: 3060,
      source: 'verified',
    });
  });
});

describe('battlecast6Rating — MCOCHUB anchors at (R1, 0)', () => {
  it('cosmic-egg R1 sig 0 = 2740 (mcochub-alpha)', () => {
    expect(battlecast6Rating('cosmic-egg', 'R1', 0)).toEqual({
      rating: 2740,
      source: 'mcochub-alpha',
    });
  });

  it('spider-man-2099 R1 sig 0 = 2283 (mcochub-alpha)', () => {
    expect(battlecast6Rating('spider-man-2099', 'R1', 0)).toEqual({
      rating: 2283,
      source: 'mcochub-alpha',
    });
  });

  it('wolverine R1 sig 0 = 1738 (mcochub-alpha)', () => {
    expect(battlecast6Rating('wolverine', 'R1', 0)).toEqual({
      rating: 1738,
      source: 'mcochub-alpha',
    });
  });
});

describe('battlecast6Rating — null returns', () => {
  it('cosmic-egg R3 sig 60 returns null (no data)', () => {
    expect(battlecast6Rating('cosmic-egg', 'R3', 60)).toBeNull();
  });

  it('cosmic-egg R1 sig 20 returns null — MCOCHUB anchor is only for (R1, 0)', () => {
    expect(battlecast6Rating('cosmic-egg', 'R1', 20)).toBeNull();
  });

  it('gamora R5 sig 200 returns null (no verified, MCOCHUB only applies at R1 sig 0)', () => {
    expect(battlecast6Rating('gamora', 'R5', 200)).toBeNull();
  });
});

describe('catalogue structure', () => {
  it('every id in BATTLECAST_6STAR_IDS has a catalogue entry', () => {
    for (const id of BATTLECAST_6STAR_IDS) {
      expect(BATTLECAST_6STAR_CATALOG[id]).toBeDefined();
    }
  });

  it('every catalogue id matches its key', () => {
    for (const id of BATTLECAST_6STAR_IDS) {
      expect(BATTLECAST_6STAR_CATALOG[id].id).toBe(id);
    }
  });

  it('catalogue has 8 entries (Mister Sinister deferred — MCOCHUB data incomplete)', () => {
    expect(BATTLECAST_6STAR_IDS.length).toBe(8);
  });

  it('cosmic-egg is the only entry with a verified anchor', () => {
    const withVerified = BATTLECAST_6STAR_IDS.filter(
      (id) => BATTLECAST_6STAR_CATALOG[id].verified.length > 0,
    );
    expect(withVerified).toEqual(['cosmic-egg']);
  });
});
