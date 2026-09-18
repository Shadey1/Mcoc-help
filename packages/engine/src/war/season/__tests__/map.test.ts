import { describe, expect, it } from 'vitest';
import { ALL_NODES, EDGES, LANE, PT, lane, pathOf, pos, whereLabel } from '../map.js';

describe('map geometry', () => {
  it('has all 50 node numbers', () => {
    expect(ALL_NODES.length).toBe(50);
    expect(ALL_NODES[0]).toBe(1);
    expect(ALL_NODES[49]).toBe(50);
  });

  it('pos returns coordinates for every node 1..50', () => {
    for (const n of ALL_NODES) {
      const [x, y] = pos(n);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('pos throws on an out-of-range node', () => {
    expect(() => pos(0)).toThrow();
    expect(() => pos(51)).toThrow();
  });

  it('path 1 holds nodes 1, 10, 19, 28 (per handover)', () => {
    expect(pathOf(1)).toBe(1);
    expect(pathOf(10)).toBe(1);
    expect(pathOf(19)).toBe(1);
    expect(pathOf(28)).toBe(1);
    expect(pathOf(37)).toBeNull();
  });

  it('lane returns a valid LANE key for every node', () => {
    for (const n of ALL_NODES) {
      const l = lane(n);
      expect(LANE[l]).toBeDefined();
    }
  });

  it('whereLabel differentiates sections', () => {
    expect(whereLabel(1)).toBe('Section 1, path 1');
    expect(whereLabel(19)).toBe('Section 2, path 1');
    expect(whereLabel(40)).toBe('Section 3');
    expect(whereLabel(46)).toBe('Mini boss');
    expect(whereLabel(50)).toBe('Boss');
  });

  it('EDGES references only known endpoints (numbers 1..50 or PT keys)', () => {
    const ptKeys = new Set(Object.keys(PT));
    const isValid = (e: number | string): boolean =>
      (typeof e === 'number' && e >= 1 && e <= 50) ||
      (typeof e === 'string' && ptKeys.has(e));
    for (const edge of EDGES) {
      expect(isValid(edge[0] as number | string)).toBe(true);
      expect(isValid(edge[1] as number | string)).toBe(true);
    }
  });

  it('every node has at least one edge (no isolated nodes)', () => {
    const seen = new Set<number>();
    for (const [a, b] of EDGES) {
      if (typeof a === 'number') seen.add(a);
      if (typeof b === 'number') seen.add(b);
    }
    for (const n of ALL_NODES) {
      expect(seen.has(n)).toBe(true);
    }
  });
});
