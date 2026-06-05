/**
 * Relic prestige — 6★ Statcast model. v2 scope (architecture-v5 §3).
 *
 * Single continuous progression curve, NOT rank-base + level-bonus as
 * separate tables. Indexed by (rank, level bracket). Class / type / flavour
 * / bound-champion all independent (verified across Sturdy / Tough /
 * Impactful / Shielded / Expert / Insulated × Tech / Science / Skill /
 * Mutant / Cosmic).
 *
 * Seamless across rank boundaries: the rating at R(n) level 60 equals the
 * rating at R(n+1) level 0. Verified at the R1/R2 boundary (1,122 in both
 * positions). Within-rank shape: +162 at the first level bracket (L0→L20),
 * then +54 per bracket thereafter — verified for 3 consecutive brackets.
 *
 * Scope discipline: this module exists as a data scaffold + math harness
 * for future capture. It is NOT exported from packages/engine/src/index.ts
 * and is NOT wired to recommendations / roster / ceiling. The intent is to
 * lock the verified anchors with tests so future captures slot in safely
 * without regressing what's already been read off real screenshots.
 *
 * Anything not in the verified set is flagged `isAlpha: true` — UI should
 * show a provisional pip rather than treating it as fact (same spirit as
 * the ascendable provenance pip, architecture-v5 §9.1).
 *
 * Verified anchors (8 points, all from in-game captures dated 2026-06-05):
 *   R1: L0=852  L20=1014 L40=1068 L60=1122
 *   R2: L0=1122 L20=1284
 *   R3: L20=1554 L40=1608
 *
 * Boundary verification: R1 L60 == R2 L0 == 1122 — single ladder confirmed.
 *
 * Drop note: the earlier "unleveled R1 = 420" reading is treated as noise
 * (LV1 / awakened-lock artifact, doesn't fit the ladder) and intentionally
 * absent from the table.
 */

export type RelicRank = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

/** Level brackets present in the in-game LV/20 readings. Sized 0..200 to
 *  match the conjectured 10-levels-per-rank range, but only L0..L60 are
 *  verified at any rank today — everything else is null and routes through
 *  the alpha-fill provisional curve. */
export type LevelBracket =
  | 0 | 20 | 40 | 60 | 80 | 100 | 120 | 140 | 160 | 180 | 200;

export const LEVEL_BRACKETS: readonly LevelBracket[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
] as const;

export const RELIC_RANKS: readonly RelicRank[] = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

/**
 * Verified ratings only. `null` = data not yet captured — the lookup will
 * synthesise a provisional value via alphaFill() and flag it isAlpha:true.
 *
 * Never overwrite a null with a derived value here; the table is the
 * verified-fact layer and the alpha layer is computed separately.
 */
export const RELIC_RATING: Record<RelicRank, Record<LevelBracket, number | null>> = {
  R1: {
    0: 852,
    20: 1014,
    40: 1068,
    60: 1122,
    80: null,
    100: null,
    120: null,
    140: null,
    160: null,
    180: null,
    200: null,
  },
  R2: {
    0: 1122,
    20: 1284,
    40: null,
    60: null,
    80: null,
    100: null,
    120: null,
    140: null,
    160: null,
    180: null,
    200: null,
  },
  R3: {
    0: null,
    20: 1554,
    40: 1608,
    60: null,
    80: null,
    100: null,
    120: null,
    140: null,
    160: null,
    180: null,
    200: null,
  },
  R4: {
    0: null, 20: null, 40: null, 60: null, 80: null,
    100: null, 120: null, 140: null, 160: null, 180: null, 200: null,
  },
  R5: {
    0: null, 20: null, 40: null, 60: null, 80: null,
    100: null, 120: null, 140: null, 160: null, 180: null, 200: null,
  },
};

export interface RelicRating {
  rating: number;
  /** True when the value comes from the provisional curve rather than a
   *  verified capture. UI should label these as estimates. */
  isAlpha: boolean;
}

/**
 * Provisional within-rank curve, used to fill gaps in RELIC_RATING.
 *
 * Shape: L0 = rank base, L20 = base + 162, then +54 per subsequent bracket.
 * Verified for the L0→L60 portion of R1 and the L0→L20 step at R2 and R3
 * — extrapolation past L60 has no captures to back it up.
 */
function alphaFill(rank: RelicRank, level: LevelBracket): number {
  const base = firstKnownBase(rank);
  if (level === 0) return base;
  return base + 162 + 54 * (level / 20 - 1);
}

/**
 * Resolve a rank's level-0 rating.
 *
 * - If the rank has a verified L0 in RELIC_RATING, return that.
 * - Otherwise derive via the seamless-boundary rule: R(n) L0 == R(n-1)'s
 *   L60. Computed recursively up to R1.
 *
 * Recursion bottom: R1's L0 is verified (852). If RELIC_RATING is later
 * cleared, the fallback constant keeps the curve from imploding.
 *
 * Conservative choice: derives R(n) L0 from R(n-1) L60 (the only
 * empirically-verified boundary) rather than R(n-1) L200. If captures
 * later show that L200 is the true rank-up trigger, replace this.
 */
function firstKnownBase(rank: RelicRank): number {
  const verified = RELIC_RATING[rank][0];
  if (verified != null) return verified;

  const idx = RELIC_RANKS.indexOf(rank);
  if (idx <= 0) return 852; // R1 fallback — should never hit, R1 L0 is verified

  const prev = RELIC_RANKS[idx - 1]!;
  // R(n-1)'s L60 under the within-rank curve: base + 162 + 54*(3-1) = base + 270.
  return firstKnownBase(prev) + 270;
}

/**
 * Look up the prestige rating for a relic at (rank, level bracket).
 *
 * Returns the verified value with `isAlpha: false` when present, otherwise
 * a provisional value with `isAlpha: true`. Callers are expected to
 * surface the alpha flag in the UI — never present an alpha rating as
 * verified fact.
 */
export function relicRating(rank: RelicRank, level: LevelBracket): RelicRating {
  const v = RELIC_RATING[rank]?.[level];
  if (v != null) return { rating: v, isAlpha: false };
  return { rating: alphaFill(rank, level), isAlpha: true };
}
