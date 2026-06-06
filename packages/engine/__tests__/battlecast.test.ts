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

describe('battlecast6Rating — verified anchors from user captures', () => {
  it('spider-man-2099 R4 sig 200 = 2283 (verified)', () => {
    expect(battlecast6Rating('spider-man-2099', 'R4', 200)).toEqual({
      rating: 2283,
      source: 'verified',
    });
  });

  it('wolverine R3 sig 100 = 1738 (verified)', () => {
    expect(battlecast6Rating('wolverine', 'R3', 100)).toEqual({
      rating: 1738,
      source: 'verified',
    });
  });

  it('mister-sinister R4 sig 180 = 2213 (verified)', () => {
    expect(battlecast6Rating('mister-sinister', 'R4', 180)).toEqual({
      rating: 2213,
      source: 'verified',
    });
  });

  it('gamora R2 sig 41 = 1324 — per-1 sig (between 20-step brackets)', () => {
    expect(battlecast6Rating('gamora', 'R2', 41)).toEqual({
      rating: 1324,
      source: 'verified',
    });
  });

  it('scarlet-witch R1 sig 61 = 1102 — per-1 sig', () => {
    expect(battlecast6Rating('scarlet-witch', 'R1', 61)).toEqual({
      rating: 1102,
      source: 'verified',
    });
  });
});

describe('battlecast6Rating — null returns', () => {
  it('cosmic-egg R3 sig 60 returns null (no data at this state)', () => {
    expect(battlecast6Rating('cosmic-egg', 'R3', 60)).toBeNull();
  });

  it('cosmic-egg R1 sig 0 returns null — MCOCHUB-α fallback dropped', () => {
    expect(battlecast6Rating('cosmic-egg', 'R1', 0)).toBeNull();
  });

  it('gamora R2 sig 40 returns null — verified is at sig 41, no interpolation', () => {
    expect(battlecast6Rating('gamora', 'R2', 40)).toBeNull();
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

  it('catalogue has 25 entries — full 6★ battlecast roster from Fandom wiki + Cosmic Egg', () => {
    expect(BATTLECAST_6STAR_IDS.length).toBe(25);
  });

  it('every catalogued entry now has at least one verified anchor', () => {
    const withoutVerified = BATTLECAST_6STAR_IDS.filter(
      (id) => BATTLECAST_6STAR_CATALOG[id].verified.length === 0,
    );
    expect(withoutVerified).toEqual([]);
  });

  it.skip('cosmic-egg is the only entry with a verified anchor', () => {
    const withVerified = BATTLECAST_6STAR_IDS.filter(
      (id) => BATTLECAST_6STAR_CATALOG[id].verified.length > 0,
    );
    expect(withVerified).toEqual(['cosmic-egg']);
  });
});
