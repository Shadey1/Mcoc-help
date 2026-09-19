import { z } from 'zod';

/**
 * Season file schema — validates data/aw/season-<N>.json.
 *
 * One file per war season. Written by `scripts/extract-aw-season.ts`
 * (run by hand), consumed at runtime by the war planner UI.
 *
 * Map geometry (node positions, edges, lane colours) is NOT in this
 * file — it lives in code at `packages/engine/src/war/season/map.ts`
 * because the map itself is stable across seasons.
 */

const ChampionId = z.string().min(1).max(200);

export const SeasonNode = z.object({
  /** Node number, 1..50. */
  node: z.number().int().min(1).max(50),
  /** Display-only buff strings, one entry per distinct buff. */
  buffs: z.array(z.string()),
  /**
   * Ordered guide picks, up to 8. Order matters — the solver's fit
   * function scales fit as `w × (100 − 9i)`, so pick 0 is worth ~3.6×
   * more than pick 7 before key-node weighting amplifies it.
   * Empty array = the guide had no picks for this node; solver falls
   * through to the `dv × 0.55` pickless-node formula.
   */
  guideDefenders: z.array(ChampionId).max(8),
  /** Extractor notes about anything it wasn't sure of (buff wrap
   *  ambiguity, low-confidence portrait match). Empty when clean. */
  reviewFlags: z.array(z.string()).optional(),
});
export type SeasonNode = z.infer<typeof SeasonNode>;

export const Season = z
  .object({
  /** Season number, e.g. 69. */
  season: z.number().int().min(1),
  /** Attribution — always credit the guide source on the page. */
  source: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    capturedAt: z.string(),
    /** Hash of the guide's pick-table images at capture; the extractor's
     *  --check compares against it to spot a mid-season guide edit. */
    fingerprint: z.string().optional(),
  }),
  /** Exactly 50 node entries, one per node number 1..50. */
  nodes: z.array(SeasonNode).length(50),
  /** Default key nodes (the ones the UI marks red on first load).
   *  Typically the boss island: [48, 49, 50]. Officer can edit. */
  defaultKeyNodes: z.array(z.number().int().min(1).max(50)),
  })
  .superRefine((season, ctx) => {
    const seen = new Set<number>();
    for (const n of season.nodes) {
      if (seen.has(n.node)) ctx.addIssue({ code: 'custom', message: `node ${n.node} appears twice` });
      seen.add(n.node);
      if (new Set(n.guideDefenders).size !== n.guideDefenders.length) {
        ctx.addIssue({ code: 'custom', message: `node ${n.node} lists the same defender twice` });
      }
    }
  });
export type Season = z.infer<typeof Season>;

/**
 * Defender-values file schema — validates data/aw/defender-values.json.
 *
 * Per-champion dv value ∈ [0, 100]. Consumed by the solver's fit function
 * as the fallback score for pickless nodes and off-list-in-strict-off
 * placements. Officer can iterate.
 *
 * Seeded initially at dv=70 for every 7★ champion — a neutral middle
 * value that lets the solver run without biasing toward anyone in
 * particular. Adjust based on how a given alliance judges each defender.
 */
export const DefenderValues = z.object({
  _meta: z
    .object({
      seededAt: z.string(),
      note: z.string(),
    })
    .optional(),
  /** championId → 0..100. */
  values: z.record(ChampionId, z.number().min(0).max(100)),
});
export type DefenderValues = z.infer<typeof DefenderValues>;
