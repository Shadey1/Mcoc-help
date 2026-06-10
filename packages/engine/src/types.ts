import { z } from 'zod';

// ─── Core enums ─────────────────────────────────────────────────────────

export const ChampionClass = z.enum([
  'Mutant',
  'Skill',
  'Science',
  'Mystic',
  'Cosmic',
  'Tech',
]);
export type ChampionClass = z.infer<typeof ChampionClass>;

export const Ascension = z.enum(['A0', 'A1', 'A2']);
export type Ascension = z.infer<typeof Ascension>;

export const Rank = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Rank = z.infer<typeof Rank>;

// ─── Sig bracket data (per-rank, 5 anchor points) ───────────────────────

/**
 * Per-rank sig BHR anchor points.
 *
 * v5 schema (current): 11 brackets at sig 0/20/40/60/80/100/120/140/160/180/200
 *   — matches MCOCHUB's publishing granularity. When all 11 are populated the
 *   engine piecewise-linear interpolates between adjacent anchors, which is
 *   accurate to within rounding for any sig value.
 *
 * Legacy entries with only sig 0 and sig 200 still work — the engine falls
 * back to a global rank-default curve. The 50/100/150 anchors from the
 * original v0.x schema are accepted (forward-compat) but ignored; MCOCHUB
 * publishes on 20-step intervals so those slots are unused going forward.
 */
export const SigBrackets = z.object({
  '0': z.number().int().positive(),
  '20': z.number().int().positive().nullable().optional(),
  '40': z.number().int().positive().nullable().optional(),
  '50': z.number().int().positive().nullable().optional(),
  '60': z.number().int().positive().nullable().optional(),
  '80': z.number().int().positive().nullable().optional(),
  '100': z.number().int().positive().nullable().optional(),
  '120': z.number().int().positive().nullable().optional(),
  '140': z.number().int().positive().nullable().optional(),
  '150': z.number().int().positive().nullable().optional(),
  '160': z.number().int().positive().nullable().optional(),
  '180': z.number().int().positive().nullable().optional(),
  '200': z.number().int().positive(),
});
export type SigBrackets = z.infer<typeof SigBrackets>;

// ─── Champion ───────────────────────────────────────────────────────────

export const Champion = z.object({
  id: z.string(),
  name: z.string(),
  class: ChampionClass,
  ascendable: z.boolean(),
  /**
   * Optional — entries representing champions that exist only as synergy
   * partners (not yet released at 7-star, no Kabam-published prestige data)
   * carry sevenStarReleased=false and omit prestige entirely. The engine
   * never sees them: loadActiveChampions() filters them out before lookup.
   */
  prestige: z
    .object({
      rank5: SigBrackets,
      rank4: SigBrackets.optional(),
      rank3: SigBrackets.optional(),
    })
    .optional(),
  /** Override identifier for non-standard sig curves (Aegon, Hercules, etc.). null = use rank default. */
  sigCurve: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  released: z.string().optional(),
  /** Hot-linked portrait URL (typically from Fandom CDN). Null = no portrait
   * known; UI falls back to the class icon. See architecture-v5.md §17 for
   * the portrait-sourcing decision. */
  portraitUrl: z.string().nullable().default(null),
  /**
   * Whether this champion has been released at 7-star rarity yet. The seed
   * carries placeholder/anticipated entries for champions known to be coming
   * (e.g. announced in a Kabam patch note but not yet in the basic crystal
   * pool). When false:
   *   - excluded from engine optimisation / ceiling computation entirely
   *   - shown in the champions browser with a "Coming soon" badge, greyed out
   *   - cannot be added to a roster via picker or bulk import
   *   - no 7-star portrait frame applied
   * Defaults to true — the bulk of the seed represents released 7-stars.
   */
  sevenStarReleased: z.boolean().default(true),
  _meta: z
    .object({
      lastVerified: z.string().optional(),
      bhrSource: z.string().optional(),
      ascendableSource: z.string().optional(),
    })
    .optional(),
});
export type Champion = z.infer<typeof Champion>;

// ─── Per-player state ───────────────────────────────────────────────────

export const ChampionState = z.object({
  championId: z.string(),
  rank: Rank,
  sig: z.number().int().min(0).max(200),
  ascension: Ascension,
  /**
   * Whether the rank/sig/ascension values reflect the player's actual state.
   *
   *   - `true` (default for legacy entries): user supplied these values, either
   *     by typing them in via picker/bulk-paste or by confirming a screenshot
   *     import. The engine includes the champion in atomic-move recommendations.
   *   - `false`: the champion's identity is known but state is the floor
   *     default (R3 sig 0 A0). Surfaced in ceiling view but excluded from
   *     atomic-move recommendations, since precise state matters for those.
   *
   * Optional + defaulting to true so legacy rosters migrate without
   * touching every entry.
   */
  stateConfirmed: z.boolean().optional().default(true),
  /**
   * Provenance of the entry. Drives roster-table affordances (badges, filters)
   * but doesn't affect engine math. Optional + defaulting to 'manual' so
   * legacy rosters migrate without touching every entry.
   */
  addedVia: z.enum(['screenshot', 'tickbox', 'manual']).optional().default('manual'),
});
export type ChampionState = z.infer<typeof ChampionState>;

export const Roster = z.object({
  champions: z.array(ChampionState),
});
export type Roster = z.infer<typeof Roster>;

// ─── Atomic moves ───────────────────────────────────────────────────────

export const AtomicMove = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rank-up'),
    championId: z.string(),
    fromRank: Rank,
    toRank: Rank,
  }),
  z.object({
    kind: z.literal('sig-up'),
    championId: z.string(),
    fromSig: z.number().int().min(0).max(200),
    toSig: z.number().int().min(0).max(200),
  }),
  z.object({
    kind: z.literal('ascend'),
    championId: z.string(),
    fromAscension: Ascension,
    toAscension: Ascension,
  }),
]);
export type AtomicMove = z.infer<typeof AtomicMove>;

// ─── Cost gates (the four-axis v5 taxonomy) ─────────────────────────────

export const CostGateKind = z.enum([
  'rank-cats', // T6B + T3A (deterministic, farmable)
  'sig-stones', // generic or class-specific (semi-deterministic, often bottlenecked)
  'ascension', // A1/A2 cluster drops (luck-gated)
]);
export type CostGateKind = z.infer<typeof CostGateKind>;

export const CostGate = z.object({
  kind: CostGateKind,
  /** Human-readable label, e.g. "T6B + T3A Cosmic" or "A2 cluster — pulls req'd" */
  label: z.string(),
  /** Class-specificity, for rank-cats and sig-stones */
  championClass: ChampionClass.optional(),
});
export type CostGate = z.infer<typeof CostGate>;

// ─── Scored output for the recommendations engine ───────────────────────

export type ScoredMove = {
  move: AtomicMove;
  championName: string;
  championClass: ChampionClass;
  beforeBHR: number;
  afterBHR: number;
  top30Delta: number;
  costGates: CostGate[];
  /** v5 deferral flag: set when this is an R4→R5 on an A0-ascendable champion. */
  deferRecommendation: 'ascend-first' | null;
  /** v5 advisory: this move advances rank/sig on an ascendable champion who could still go higher. */
  statePersistenceNote: string | null;
};

// ─── Ceiling-view output ────────────────────────────────────────────────

export type CeilingEntry = {
  championId: string;
  championName: string;
  championClass: ChampionClass;
  /** Is this champion currently in the user's roster? When false, currentBHR
   * is 0 and the entry represents a "what if you pulled them" scenario. */
  owned: boolean;
  currentBHR: number;
  ceilingBHR: number;
  headroomBHR: number;
  prestigeDeltaIfMaxed: number;
  inTop30: boolean;
  ascendable: boolean;
  /** Total cost gates needed to traverse from current → ceiling. Empty for
   * unowned champions — acquisition is luck-gated and the path from a fresh
   * pull is the same standard path for any champion. */
  totalCostGates: CostGate[];
};
