import { describe, expect, it } from 'vitest';
import {
  R6_STATCAST_LEVELS,
  R6_STATCAST_RANKS,
  R6_STATCAST_RATING,
  r6StatcastRating,
} from '../src/index.js';

describe('relic module — renamed exports surface from engine index', () => {
  it('R6_STATCAST_RANKS is the 5-rank tuple', () => {
    expect(R6_STATCAST_RANKS).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
  });
  it('R6_STATCAST_LEVELS is the 11-bracket array (sig 0..200)', () => {
    expect(R6_STATCAST_LEVELS).toEqual([
      0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
    ]);
  });
  it('R6_STATCAST_RATING has all 5 ranks', () => {
    expect(Object.keys(R6_STATCAST_RATING).sort()).toEqual([
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
    ]);
  });
  it('r6StatcastRating returns the verified R1 L60 anchor', () => {
    expect(r6StatcastRating('R1', 60)).toEqual({ rating: 1122, isAlpha: false });
  });
});
