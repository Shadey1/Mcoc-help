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
 * Piecewise-linear BHR at the given sig from a per-champion anchor table.
 * Caller must ensure at least two anchors (sig 0 and sig 200 are always
 * required by the schema). Sigs outside [0, 200] are clamped.
 */
function interpFromAnchors(anchors: Array<[number, number]>, sig: number): number {
  if (sig <= anchors[0]![0]) return anchors[0]![1];
  if (sig >= anchors[anchors.length - 1]![0]) return anchors[anchors.length - 1]![1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [loSig, loBhr] = anchors[i]!;
    const [hiSig, hiBhr] = anchors[i + 1]!;
    if (sig >= loSig && sig <= hiSig) {
      const t = (sig - loSig) / (hiSig - loSig);
      return loBhr + (hiBhr - loBhr) * t;
    }
  }
  return anchors[anchors.length - 1]![1];
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
 */
export function calculateBHR(champion: Champion, state: ChampionState): number {
  if (state.championId !== champion.id) {
    throw new Error(
      `Champion mismatch: state references ${state.championId}, champion is ${champion.id}`,
    );
  }

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
 */
export function calculateCeilingBHR(champion: Champion): number {
  const sig200R5 = champion.prestige.rank5['200'];
  const maxAscMult = champion.ascendable ? ASCENSION_MULT.A2 : ASCENSION_MULT.A0;
  return roundToTen(sig200R5 * maxAscMult);
}
