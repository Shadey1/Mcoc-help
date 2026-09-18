import { describe, expect, it } from 'vitest';
import { copyStrength, fit, meetsFloor, resolvePicks } from '../fit.js';
import type { ChampionId, NodeNumber, SeasonPlan } from '../types.js';
import type { Ascension, ChampionState, Rank } from '../../../types.js';

function plan(overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    season: 69,
    bg: 1,
    guidePicks: {},
    pickOverrides: {},
    keyNodes: new Set(),
    pins: {},
    excludedPlayers: new Set(),
    strict: false,
    ...overrides,
  };
}

const DV: ReadonlyMap<ChampionId, number> = new Map([
  ['a', 80],
  ['b', 60],
  ['c', 40],
]);

describe('resolvePicks', () => {
  it('returns override when set', () => {
    const p = plan({
      guidePicks: { 5: ['a', 'b'] },
      pickOverrides: { 5: ['c'] },
    });
    expect(resolvePicks(p, 5)).toEqual(['c']);
  });

  it('falls back to guide picks when no override', () => {
    const p = plan({ guidePicks: { 5: ['a', 'b'] } });
    expect(resolvePicks(p, 5)).toEqual(['a', 'b']);
  });

  it('returns empty when neither set', () => {
    expect(resolvePicks(plan(), 5)).toEqual([]);
  });

  it('empty override wins over guide (officer explicitly cleared)', () => {
    const p = plan({
      guidePicks: { 5: ['a'] },
      pickOverrides: { 5: [] },
    });
    expect(resolvePicks(p, 5)).toEqual([]);
  });
});

describe('fit scoring', () => {
  it('top pick on a non-key node: w=1.5, score=150, rank=0', () => {
    const p = plan({ guidePicks: { 1: ['a', 'b'] } });
    expect(fit('a', 1, p, DV)).toEqual({ score: 150, rank: 0 });
  });

  it('top pick on a key node: w=3, score=300, rank=0', () => {
    const p = plan({ guidePicks: { 50: ['a', 'b'] }, keyNodes: new Set([50]) });
    expect(fit('a', 50, p, DV)).toEqual({ score: 300, rank: 0 });
  });

  it('pick-index falloff: 8th pick on non-key is 1.5 * (100-63) = 55.5', () => {
    const p = plan({ guidePicks: { 1: ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'a'] } });
    expect(fit('a', 1, p, DV)).toEqual({ score: 55.5, rank: 7 });
  });

  it('unlisted in strict mode returns null (edge forbidden)', () => {
    const p = plan({ guidePicks: { 1: ['a'] }, strict: true });
    expect(fit('b', 1, p, DV)).toBeNull();
  });

  it('unlisted in non-strict mode: w * dv * 0.3', () => {
    const p = plan({ guidePicks: { 1: ['a'] } });
    // b's dv is 60, w = 1.5 → 1.5 * 60 * 0.3 = 27
    expect(fit('b', 1, p, DV)).toEqual({ score: 27, rank: -1 });
  });

  it('no picks at all: dv * 0.55, no key weight', () => {
    const p = plan({ keyNodes: new Set([1]) }); // key doesn't matter for pickless
    // a's dv is 80 → 80 * 0.55 = 44
    expect(fit('a', 1, p, DV)).toEqual({ score: 44, rank: -2 });
  });

  it('override wins over guide in fit lookup too', () => {
    const p = plan({
      guidePicks: { 1: ['a', 'b'] },
      pickOverrides: { 1: ['b', 'a'] },
    });
    expect(fit('b', 1, p, DV)?.rank).toBe(0);
    expect(fit('a', 1, p, DV)?.rank).toBe(1);
  });

  it('unknown champion falls back to dv=50', () => {
    const p = plan({ guidePicks: { 1: ['a'] } });
    // unknown, non-strict, non-listed → 1.5 * 50 * 0.3 = 22.5
    expect(fit('unknown', 1, p, DV)).toEqual({ score: 22.5, rank: -1 });
  });
});

describe('copyStrength', () => {
  const state = (rank: Rank, sig: number, asc: Ascension): ChampionState => ({
    championId: 'x',
    rank,
    sig,
    ascension: asc,
    stateConfirmed: true,
    addedVia: 'manual',
  });

  it('R4 A0 sig 0 = 4', () => {
    expect(copyStrength(state(4 as Rank, 0, 'A0'))).toBe(4);
  });

  it('R5 A0 sig 200 = 5.5', () => {
    expect(copyStrength(state(5 as Rank, 200, 'A0'))).toBe(5.5);
  });

  it('R5 A2 sig 200 = 7.5', () => {
    expect(copyStrength(state(5 as Rank, 200, 'A2'))).toBe(7.5);
  });

  it('R6 A2 sig 200 = 9.5 (R6 base = 7 per effective-rank ladder)', () => {
    expect(copyStrength(state(6 as Rank, 200, 'A2'))).toBe(9.5);
  });

  it('sig 100 sits between sig 0 and sig 200', () => {
    const at0 = copyStrength(state(5 as Rank, 0, 'A0'));
    const at100 = copyStrength(state(5 as Rank, 100, 'A0'));
    const at200 = copyStrength(state(5 as Rank, 200, 'A0'));
    expect(at0).toBeLessThan(at100);
    expect(at100).toBeLessThan(at200);
  });
});

describe('meetsFloor', () => {
  const s = (r: Rank, a: Ascension): ChampionState => ({
    championId: 'x',
    rank: r,
    sig: 200,
    ascension: a,
    stateConfirmed: true,
    addedVia: 'manual',
  });

  it('R5 A0 meets a floor of R4 A0', () => {
    expect(meetsFloor(s(5 as Rank, 'A0'), { rank: 4, ascension: 'A0' })).toBe(true);
  });

  it('R4 A0 does not meet a floor of R5 A0', () => {
    expect(meetsFloor(s(4 as Rank, 'A0'), { rank: 5, ascension: 'A0' })).toBe(false);
  });

  it('R4 A2 meets a floor of R5 A0 (equal effective rank)', () => {
    expect(meetsFloor(s(4 as Rank, 'A2'), { rank: 5, ascension: 'A0' })).toBe(true);
  });

  it('R4 A1 does not meet a floor of R5 A1 (5 vs 6)', () => {
    expect(meetsFloor(s(4 as Rank, 'A1'), { rank: 5, ascension: 'A1' })).toBe(false);
  });
});
