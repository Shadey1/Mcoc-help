import type { NodeNumber } from './types.js';

/**
 * War map geometry. Fixed across seasons — Kabam doesn't reshape the map
 * between wars. If they ever do, this is where the update lands (plus a
 * per-season override in `SeasonFile` — not implemented yet).
 *
 * Coordinates and edge list are traced from the shared AW map image and
 * are the ground truth for both the SVG in the UI and the PNG exports.
 * Keep this module DOM-free so it can be imported into the engine tests.
 *
 * Node numbering:
 *   1..36  — sections 1 and 2, three parallel paths (r/o/y/g/s/t/b/p/k)
 *            of four nodes each; path N holds nodes N, N+9, N+18, N+27.
 *   37..45 — section 3, three sub-columns (SUBS)
 *   46..47 — mini-boss row
 *   48..50 — boss island (48 & 49 flanking, 50 above)
 */

/** Lane colours keyed by single-letter path code. Consumed by the map SVG
 *  and the PNG export. Kept in code (not the season file) because the
 *  colours are map-wide constants, not season-specific. */
export const LANE: Record<string, string> = {
  r: '#d95a53',
  o: '#df8a2b',
  y: '#c49b33',
  g: '#7ea337',
  s: '#67758b',
  t: '#1f9f8c',
  b: '#4583d0',
  p: '#8763d6',
  k: '#c9467a',
};

/** Path order across the three sub-columns of sections 1 and 2. */
const LORDER = ['r', 'o', 'y', 'g', 's', 't', 'b', 'p', 'k'] as const;

/** X coordinates for the three columns × three sub-columns in sections 1/2. */
const GX: readonly (readonly [number, number, number])[] = [
  [126, 216, 306],
  [450, 540, 630],
  [774, 864, 954],
];

/** Y coordinates for the four rows of section-1/2 nodes. */
const ROW_Y = [1127, 1038, 720, 630] as const;

/** Fixed positions for section-3 and boss-area nodes (37..50). */
const FIX: Record<NodeNumber, readonly [number, number]> = {
  37: [794, 372], 38: [864, 372], 39: [934, 372],
  40: [147, 372], 41: [216, 372], 42: [286, 372],
  43: [471, 372], 44: [540, 372], 45: [610, 372],
  46: [478, 190], 47: [602, 190],
  48: [478, 120], 49: [602, 120],
  50: [540, 54],
};

/** Junction/anchor points that don't correspond to any node number.
 *  Referenced by EDGES; also drawn as gold join dots on the map. */
export const PT: Record<string, readonly [number, number]> = {
  s1: [216, 1214], s2: [540, 1214], s3: [864, 1214],
  t1: [216, 954], t2: [540, 954], t3: [864, 954],
  h1: [540, 878],
  A: [216, 806], B: [540, 806], C: [864, 806],
  u1: [216, 546], u2: [540, 546], u3: [864, 546],
  l1: [216, 441], l2: [540, 441], l3: [864, 441],
  v1: [216, 306], v2: [540, 306], v3: [864, 306],
  h2: [540, 246],
};

/**
 * Coordinates for a node number. Section-1/2 nodes are computed from GX
 * and ROW_Y; section-3 and boss nodes are looked up in FIX.
 */
export function pos(k: NodeNumber): readonly [number, number] {
  if (k <= 36) {
    const i = (k - 1) % 9;
    const g = Math.floor(i / 3);
    const j = i % 3;
    const row = Math.floor((k - 1) / 9);
    return [GX[g]![j]!, ROW_Y[row]!];
  }
  const p = FIX[k];
  if (!p) throw new Error(`Unknown node number: ${k}`);
  return p;
}

/** Lane colour code for a node (letter into LANE). */
export function lane(k: NodeNumber): string {
  if (k <= 36) return LORDER[(k - 1) % 9]!;
  if (k <= 39) return 'o';
  if (k <= 42) return 'p';
  if (k <= 45) return 't';
  if (k <= 47) return 'b';
  if (k <= 49) return 'k';
  return 'y'; // node 50 boss
}

/** Path number 1..9 for section-1/2 nodes; null for section-3/boss. */
export function pathOf(k: NodeNumber): number | null {
  if (k <= 36) return ((k - 1) % 9) + 1;
  return null;
}

/** Human-readable location string for a node — for aria-labels and copy. */
export function whereLabel(k: NodeNumber): string {
  if (k <= 18) return `Section 1, path ${((k - 1) % 9) + 1}`;
  if (k <= 36) return `Section 2, path ${((k - 1) % 9) + 1}`;
  if (k <= 45) return 'Section 3';
  if (k <= 49) return 'Mini boss';
  return 'Boss';
}

/**
 * Edge list. Each entry: [from, to] where each end is either a node
 * number or a PT key. Optional 3rd element flags the edge style
 * ('hub' = dashed orange, 'dot' = dotted colour); optional 4th is the
 * dot colour. Consumed by both the SVG and the PNG export.
 */
export type Edge =
  | [NodeNumber | keyof typeof PT, NodeNumber | keyof typeof PT]
  | [NodeNumber | keyof typeof PT, NodeNumber | keyof typeof PT, 'hub']
  | [NodeNumber | keyof typeof PT, NodeNumber | keyof typeof PT, 'dot', string];

export const EDGES: Edge[] = (() => {
  const e: Edge[] = [];
  // Section 1 (s* → paths → t*)
  ([['s1', 't1', 1], ['s2', 't2', 4], ['s3', 't3', 7]] as const).forEach(([s, t, b]) => {
    for (let k = b; k < b + 3; k++) {
      e.push([s, k as NodeNumber]);
      e.push([k as NodeNumber, (k + 9) as NodeNumber]);
      e.push([(k + 9) as NodeNumber, t]);
    }
  });
  // Hub: t1/t2/t3 → h1 → A/B/C
  (['t1', 't2', 't3'] as const).forEach((t) => e.push([t, 'h1', 'hub']));
  (['A', 'B', 'C'] as const).forEach((t) => e.push(['h1', t, 'hub']));
  // Section 2 (A/B/C → paths → u*)
  ([['A', 'u1', 19], ['B', 'u2', 22], ['C', 'u3', 25]] as const).forEach(([s, t, b]) => {
    for (let k = b; k < b + 3; k++) {
      e.push([s, k as NodeNumber]);
      e.push([k as NodeNumber, (k + 9) as NodeNumber]);
      e.push([(k + 9) as NodeNumber, t]);
    }
  });
  // Cross-links between l and u (dotted colour)
  ([
    ['l1', 'u1', LANE.o!],
    ['l1', 'u3', LANE.o!],
    ['l2', 'u1', LANE.k!],
    ['l2', 'u2', LANE.k!],
    ['l2', 'u3', LANE.k!],
    ['l3', 'u1', LANE.b!],
    ['l3', 'u3', LANE.t!],
  ] as const).forEach(([a, b, c]) => e.push([a, b, 'dot', c]));
  // Section 3 (l* → nodes 37..45 → v*)
  ([['l1', 'v1', 40], ['l2', 'v2', 43], ['l3', 'v3', 37]] as const).forEach(([s, t, b]) => {
    for (let k = b; k < b + 3; k++) {
      e.push([s, k as NodeNumber]);
      e.push([k as NodeNumber, t]);
    }
  });
  // v* → h2 → mini-bosses → bosses
  (['v1', 'v2', 'v3'] as const).forEach((v) => e.push([v, 'h2']));
  e.push(['h2', 46]);
  e.push(['h2', 47]);
  e.push([46, 48]);
  e.push([47, 49]);
  e.push([48, 50]);
  e.push([49, 50]);
  return e;
})();

/** All 50 node numbers, in order. Cheap constant reused by the solver. */
export const ALL_NODES: readonly NodeNumber[] = Array.from({ length: 50 }, (_, i) => i + 1);
