import type {
  Ascension,
  Champion,
  ChampionState,
  Rank,
  SigBrackets,
} from './types.js';
import multipliers from './multipliers.json' with { type: 'json' };

// ─── Constants loaded from data/formulas/multipliers.json ───────────────

export const RANK_MULT: Partial<Record<Rank, number>> = {
  5: multipliers.ranks['5']!,
  4: multipliers.ranks['4']!,
  3: multipliers.ranks['3']!,
  // R2 and R1 deliberately omitted — out of scope for v1
};

export const ASCENSION_MULT: Record<Ascension, number> = {
  A0: multipliers.ascension.A0,
  A1: multipliers.ascension.A1,
  A2: multipliers.ascension.A2,
};

/**
 * Rank-default normalised sig curves. Each entry is the fraction of the BHR
 * range (sig0 → sig200) achieved at each 20-sig increment. Champions with
 * a `sigCurve` override use a custom curve from the same registry.
 *
 * Indexed by sig bracket: 0=sig0, 1=sig20, 2=sig40, ..., 10=sig200.
 */
const SIG_CURVES: Record<string, readonly number[]> = {
  rank5_default: multipliers.sigCurves.rank5_default,
  rank4_default: multipliers.sigCurves.rank4_default,
  rank3_default: multipliers.sigCurves.rank3_default,
};

const SIG_ANCHORS = multipliers.sigCurves._anchors_sig; // [0, 20, 40, ..., 200]

/** Sig anchors for the per-champion full-bracket fast path. Keep in lockstep
 *  with the SigBrackets schema in types.ts and MCOCHUB's publishing cadence. */
const FULL_ANCHORS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200] as const;

// ─── Pure helpers ───────────────────────────────────────────────────────

/**
 * Round to nearest 10 — matches in-game BHR display convention.
 * The game truncates BHR to increments of 10; our predictions must too.
 */
function roundToTen(n: number): number {
  return Math.round(n / 10) * 10;
}

/**
 * Look up the sig-curve fraction at a given sig level, using the appropriate
 * curve for the champion's rank (or per-champion override if specified).
 *
 * Interpolates linearly between the 20-sig anchor points if the input sig
 * isn't exactly on an anchor (sig 47 → between sig 40 and sig 60).
 */
function sigFraction(rank: Rank, sig: number, override: string | null): number {
  const curveKey = override ?? `rank${rank}_default`;
  const curve = SIG_CURVES[curveKey];
  if (!curve) {
    throw new Error(`Unknown sig curve: ${curveKey}`);
  }

  // Find anchor bracket: largest anchor ≤ sig, smallest anchor ≥ sig
  if (sig <= 0) return curve[0]!;
  if (sig >= 200) return curve[curve.length - 1]!;

  // Binary-or-linear scan; the array is small so linear is fine
  for (let i = 0; i < SIG_ANCHORS.length - 1; i++) {
    const lo = SIG_ANCHORS[i]!;
    const hi = SIG_ANCHORS[i + 1]!;
    if (sig >= lo && sig <= hi) {
      const fLo = curve[i]!;
      const fHi = curve[i + 1]!;
      const t = (sig - lo) / (hi - lo);
      return fLo + (fHi - fLo) * t;
    }
  }
  // Defensive — should never reach here given the bounds checks above
  return curve[curve.length - 1]!;
}

/**
 * Read the absolute BHR at every populated anchor in a SigBrackets entry,
 * returning [sig, bhr] pairs sorted ascending. Used by the per-champion
 * piecewise interpolation path — when MCOCHUB has published all 11 anchors
 * we interpolate between them directly, no curve approximation.
 */
function readPopulatedAnchors(brackets: SigBrackets): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const anchor of FULL_ANCHORS) {
    const key = String(anchor) as keyof SigBrackets;
    const v = brackets[key];
    if (typeof v === 'number') out.push([anchor, v]);
  }
  return out;
}

/**
 * PCHIP slopes at every anchor using the Fritsch-Carlson algorithm.
 *
 * Returns slope[i] for each anchor. Monotonic-preserving: if the data is
 * monotonic (which BHR-vs-sig always is), the resulting cubic Hermite
 * spline does not overshoot or oscillate. Interior slopes use a weighted
 * harmonic mean of adjacent segment slopes; endpoints use the standard
 * three-point boundary estimate, clamped if it would break monotonicity.
 *
 * See Fritsch & Carlson, "Monotone Piecewise Cubic Interpolation",
 * SIAM J. Numer. Anal. 17 (1980).
 */
function pchipSlopes(anchors: Array<[number, number]>): number[] {
  const n = anchors.length;
  const h: number[] = new Array(n - 1);
  const d: number[] = new Array(n - 1); // segment slopes Δ
  for (let i = 0; i < n - 1; i++) {
    h[i] = anchors[i + 1]![0] - anchors[i]![0];
    d[i] = (anchors[i + 1]![1] - anchors[i]![1]) / h[i]!;
  }
  const m: number[] = new Array(n);
  // Interior
  for (let i = 1; i < n - 1; i++) {
    const dLo = d[i - 1]!;
    const dHi = d[i]!;
    if (dLo * dHi <= 0) {
      m[i] = 0;
    } else {
      const hLo = h[i - 1]!;
      const hHi = h[i]!;
      const w1 = 2 * hHi + hLo;
      const w2 = hHi + 2 * hLo;
      m[i] = (w1 + w2) / (w1 / dLo + w2 / dHi);
    }
  }
  // Endpoints: three-point one-sided formula, clamped for monotonicity
  m[0] = endpointSlope(h[0]!, h[1] ?? h[0]!, d[0]!, d[1] ?? d[0]!);
  m[n - 1] = endpointSlope(
    h[n - 2]!,
    h[n - 3] ?? h[n - 2]!,
    d[n - 2]!,
    d[n - 3] ?? d[n - 2]!,
  );
  return m;
}

function endpointSlope(h1: number, h2: number, d1: number, d2: number): number {
  const m = ((2 * h1 + h2) * d1 - h1 * d2) / (h1 + h2);
  if (m * d1 <= 0) return 0;
  if (d1 * d2 <= 0 && Math.abs(m) > 3 * Math.abs(d1)) return 3 * d1;
  return m;
}

/**
 * Piecewise cubic Hermite (PCHIP) BHR at the given sig from a per-champion
 * anchor table. Passes through every anchor exactly; between anchors uses a
 * monotonic cubic informed by the local curve shape. Falls back to linear
 * interp when only 2 anchors are present. Sigs outside [0, 200] clamp.
 */
function interpFromAnchors(anchors: Array<[number, number]>, sig: number): number {
  if (sig <= anchors[0]![0]) return anchors[0]![1];
  if (sig >= anchors[anchors.length - 1]![0]) return anchors[anchors.length - 1]![1];
  if (anchors.length < 3) {
    const [loSig, loBhr] = anchors[0]!;
    const [hiSig, hiBhr] = anchors[1]!;
    const t = (sig - loSig) / (hiSig - loSig);
    return loBhr + (hiBhr - loBhr) * t;
  }
  const slopes = pchipSlopes(anchors);
  for (let i = 0; i < anchors.length - 1; i++) {
    const [loSig, loBhr] = anchors[i]!;
    const [hiSig, hiBhr] = anchors[i + 1]!;
    if (sig >= loSig && sig <= hiSig) {
      const h = hiSig - loSig;
      const t = (sig - loSig) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      // Hermite basis functions
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      return (
        h00 * loBhr +
        h10 * h * slopes[i]! +
        h01 * hiBhr +
        h11 * h * slopes[i + 1]!
      );
    }
  }
  return anchors[anchors.length - 1]![1];
}

// ─── BHR overrides ───────────────────────────────────────────────────────

/**
 * User-supplied calibration overrides: when the engine's prediction
 * disagrees with what the game actually displays, the user can pin the
 * exact value for a specific (champion, rank, sig, ascension) state and
 * the engine returns that pinned value instead of computing one.
 *
 * The map key encodes the full state via `bhrOverrideKey()`. Values are
 * the integer BHRs the user typed in, stored verbatim (no rounding).
 *
 * Overrides apply ONLY to the exact state they were pinned for. Adjacent
 * sigs or ascensions of the same champion still go through the curve —
 * we don't extrapolate, because the underlying error could be at any
 * layer (anchor, ascension multiplier, sig curve shape).
 */
export type BHROverrideMap = ReadonlyMap<string, number>;

/** Build the canonical key for a state in the override map. */
export function bhrOverrideKey(
  championId: string,
  rank: Rank,
  sig: number,
  ascension: Ascension,
): string {
  return `${championId}|${rank}|${sig}|${ascension}`;
}

function lookupOverride(
  overrides: BHROverrideMap | undefined,
  state: ChampionState,
): number | undefined {
  if (!overrides || overrides.size === 0) return undefined;
  return overrides.get(
    bhrOverrideKey(state.championId, state.rank, state.sig, state.ascension),
  );
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Compute Base Hero Rating (BHR) for a champion in a given state.
 *
 * BHR is what the in-game prestige page displays. Prestige itself is the
 * floor of the average of the top-30 champions' BHRs.
 *
 * Approach: take the rank's sig 0 and sig 200 anchor values from the
 * champion's data, interpolate to the player's actual sig level using the
 * rank-default (or per-champion override) sig curve, then apply the
 * ascension multiplier and round to the nearest 10.
 *
 * For ranks where the champion data has no explicit sig0/sig200 anchors
 * (e.g. only rank5 is seeded), we derive them from rank5 × rank-multiplier.
 *
 * If `overrides` contains a pinned value for this exact state, that value
 * is returned directly — no rounding, no curve.
 */
export function calculateBHR(
  champion: Champion,
  state: ChampionState,
  overrides?: BHROverrideMap,
): number {
  if (state.championId !== champion.id) {
    throw new Error(
      `Champion mismatch: state references ${state.championId}, champion is ${champion.id}`,
    );
  }

  const pinned = lookupOverride(overrides, state);
  if (pinned !== undefined) return pinned;

  const rankMult = RANK_MULT[state.rank];
  if (rankMult === undefined) {
    throw new Error(
      `Rank ${state.rank} multiplier not yet supported (R1, R2 out of scope for v1).`,
    );
  }

  // Type narrowing: only R3/R4/R5 reach this point (R1/R2 throw above)
  const rankKey = `rank${state.rank}` as 'rank3' | 'rank4' | 'rank5';
  const rankBrackets = champion.prestige[rankKey];
  const rank5Brackets = champion.prestige.rank5;

  // Fast path: champion has full 11-anchor data for the target rank.
  // Piecewise-linear interp between adjacent anchors — no global-curve
  // approximation, no per-champion error from one-curve-fits-all.
  const directAnchors = rankBrackets
    ? readPopulatedAnchors(rankBrackets)
    : [];
  if (directAnchors.length >= 3) {
    const sigBHR = interpFromAnchors(directAnchors, state.sig);
    return roundToTen(sigBHR * ASCENSION_MULT[state.ascension]);
  }

  // Fast path B: target rank has no brackets, but R5 does and we can scale.
  // MCOCHUB only publishes R5, so this is the common case for R3/R4 states.
  const rank5Anchors = readPopulatedAnchors(rank5Brackets);
  if (rank5Anchors.length >= 3 && state.rank !== 5) {
    const scaled: Array<[number, number]> = rank5Anchors.map(
      ([sig, bhr]) => [sig, bhr * rankMult],
    );
    const sigBHR = interpFromAnchors(scaled, state.sig);
    return roundToTen(sigBHR * ASCENSION_MULT[state.ascension]);
  }

  // Slow path: only sig 0 and sig 200 known. Fall back to the global
  // rank-default curve (or per-champion override) for the in-between shape.
  // Less accurate, but works for legacy seed entries that haven't been
  // refreshed yet from MCOCHUB's full curves.
  let sig0: number;
  let sig200: number;
  if (rankBrackets) {
    sig0 = rankBrackets['0'];
    sig200 = rankBrackets['200'];
  } else {
    sig0 = rank5Brackets['0'] * rankMult;
    sig200 = rank5Brackets['200'] * rankMult;
  }
  const fraction = sigFraction(state.rank, state.sig, champion.sigCurve);
  const sigBHR = sig0 + (sig200 - sig0) * fraction;
  return roundToTen(sigBHR * ASCENSION_MULT[state.ascension]);
}

/**
 * Compute a champion's MAX BHR at full development (R5 sig 200, max ascension).
 * This is the ceiling for the ceiling view.
 *
 * Respects overrides at the ceiling state (R5 sig 200, max ascension) — if
 * the user has calibrated their max-state BHR for this champion, the
 * ceiling reflects that exact value.
 */
export function calculateCeilingBHR(
  champion: Champion,
  overrides?: BHROverrideMap,
): number {
  const ceilingAsc: Ascension = champion.ascendable ? 'A2' : 'A0';
  if (overrides && overrides.size > 0) {
    const pinned = overrides.get(
      bhrOverrideKey(champion.id, 5, 200, ceilingAsc),
    );
    if (pinned !== undefined) return pinned;
  }
  const sig200R5 = champion.prestige.rank5['200'];
  return roundToTen(sig200R5 * ASCENSION_MULT[ceilingAsc]);
}
