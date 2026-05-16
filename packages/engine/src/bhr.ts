import type { Ascension, Champion, ChampionState, Rank } from './types.js';
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

  // Resolve sig0 / sig200 for the target rank
  // Type narrowing: only R3/R4/R5 reach this point (R1/R2 throw above)
  const rankKey = `rank${state.rank}` as 'rank3' | 'rank4' | 'rank5';
  const rankBrackets = champion.prestige[rankKey];

  let sig0: number;
  let sig200: number;

  if (rankBrackets) {
    sig0 = rankBrackets['0'];
    sig200 = rankBrackets['200'];
  } else {
    // Derive from rank5 via rank multiplier — accurate within rounding for standard champions
    const rank5Sig0 = champion.prestige.rank5['0'];
    const rank5Sig200 = champion.prestige.rank5['200'];
    sig0 = rank5Sig0 * rankMult;
    sig200 = rank5Sig200 * rankMult;
  }

  // Compute sig position via curve, NOT linear interpolation
  const fraction = sigFraction(state.rank, state.sig, champion.sigCurve);
  const sigBHR = sig0 + (sig200 - sig0) * fraction;

  // Apply ascension multiplier (rank multiplier already baked into sig0/sig200)
  // EXCEPT when we derived the brackets from rank5 — those need the rank multiplier
  // applied externally. The path above (rankBrackets present) already applies it.
  const ascMult = ASCENSION_MULT[state.ascension];

  // If sig0/sig200 came from the rank's own brackets, they already include rank scaling.
  // If derived from rank5, we already applied rankMult above. Either way, no double-apply.
  return roundToTen(sigBHR * ascMult);
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
