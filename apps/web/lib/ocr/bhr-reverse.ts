/**
 * Reverse-derive (rank, sig) from a known (BHR, champion, ascension).
 *
 * The engine's forward function calculateBHR(champion, state) maps a fully
 * specified state to a single BHR. We invert it by enumeration: for each
 * (rank, sig) pair in the meaningful range, compute the predicted BHR and
 * keep the closest match to the observed value.
 *
 * The search space is small enough (3 ranks × 201 sig values = 603 evals)
 * that brute force is faster than any clever inversion. Each evaluation is
 * a handful of multiplies; the whole sweep runs in <1ms.
 *
 * Why this works:
 *
 *   - BHR ranges across ranks barely overlap. R5 sig 0 is ~30k; R4 sig 200
 *     at A2 is ~34k. There IS a narrow ambiguity zone, but the engine math
 *     is monotonic in sig within a rank, so a noisy BHR observation lands
 *     decisively close to one (rank, sig) point.
 *   - Ascension is known independently (visual pip count), removing the third
 *     degree of freedom. With ascension fixed, the (rank, sig) → BHR surface
 *     is nearly bijective.
 *   - Tolerance can be loose (±200 BHR) because Tesseract's BHR OCR is
 *     generally accurate to within a few tens.
 *
 * v0.16.0 note: ChampionState gained `stateConfirmed` and `addedVia` fields
 * during v0.15.0. The synthetic states constructed here for BHR enumeration
 * fill those fields with neutral values — they aren't read by calculateBHR,
 * only the rank/sig/ascension/championId tuple matters for the math.
 */

import type { Ascension, Champion, Rank } from '@prestige-tools/engine';
import { calculateBHR } from '@prestige-tools/engine';
import type { DerivedState } from './types';

const SIG_RESOLUTION = 1;
const ACCEPT_TOLERANCE = 200;
const ALTERNATIVES_TOLERANCE = 500;
const MAX_ALTERNATIVES = 4;

/**
 * Returns the best (rank, sig) match, or null if no rank/sig combo lands
 * within tolerance. The caller decides what to do with low-confidence
 * derivations (typically: keep but flag in the UI).
 */
export function deriveStateFromBHR(
  champion: Champion,
  observedBHR: number,
  ascension: Ascension,
  toleranceOverride?: number,
): DerivedState | null {
  const tolerance = toleranceOverride ?? ACCEPT_TOLERANCE;
  type Candidate = {
    rank: Rank;
    sig: number;
    predicted: number;
    absError: number;
  };

  const candidates: Candidate[] = [];

  for (const rank of [5, 4, 3] as const) {
    try {
      for (let sig = 0; sig <= 200; sig += SIG_RESOLUTION) {
        const predicted = calculateBHR(champion, {
          championId: champion.id,
          rank,
          sig,
          ascension,
          // Neutral fills — calculateBHR doesn't read these but the type
          // requires them since v0.15.0's ChampionState evolution.
          stateConfirmed: false,
          addedVia: 'screenshot',
        });
        const absError = Math.abs(predicted - observedBHR);
        candidates.push({ rank, sig, predicted, absError });
      }
    } catch {
      // Rank not supported for this champion — skip silently
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.absError - b.absError);

  const best = candidates[0]!;
  if (best.absError > tolerance) return null;

  const preferred = pickRoundSigPreference(candidates, best.absError);
  const alternatives = collectAlternatives(candidates, preferred);

  return {
    rank: preferred.rank as 3 | 4 | 5,
    sig: preferred.sig,
    ascension,
    ocredBHR: observedBHR,
    predictedBHR: preferred.predicted,
    absError: preferred.absError,
    alternatives,
  };
}

/**
 * If multiple (rank, sig) combos land within a few BHR of the observed value,
 * prefer the one closest to a "round" sig value (multiple of 10, ideally 50).
 * BHR is rounded to the nearest 10 in-game, so several adjacent sigs can
 * predict the same BHR. The round-sig preference resolves these ties toward
 * what players actually have.
 */
function pickRoundSigPreference<C extends { sig: number; absError: number }>(
  candidates: C[],
  bestError: number,
): C {
  const tieWindow = Math.max(bestError + 10, 30);
  const ties = candidates.filter((c) => c.absError <= tieWindow);

  function roundnessPenalty(sig: number): number {
    if (sig === 0 || sig === 200) return 0;
    if (sig % 50 === 0) return 1;
    if (sig % 20 === 0) return 2;
    if (sig % 10 === 0) return 3;
    return 5;
  }

  ties.sort((a, b) => {
    const ra = roundnessPenalty(a.sig);
    const rb = roundnessPenalty(b.sig);
    if (ra !== rb) return ra - rb;
    return a.absError - b.absError;
  });
  return ties[0]!;
}

function collectAlternatives<
  C extends { rank: Rank; sig: number; predicted: number; absError: number },
>(candidates: C[], chosen: C): DerivedState['alternatives'] {
  const out: DerivedState['alternatives'] = [];
  const seen = new Set<string>();
  seen.add(`${chosen.rank}-${chosen.sig}`);

  for (const c of candidates) {
    if (out.length >= MAX_ALTERNATIVES) break;
    if (c.absError > ALTERNATIVES_TOLERANCE) break;
    const key = `${c.rank}-${c.sig}`;
    if (seen.has(key)) continue;
    const closeToExisting = out.some(
      (o) => o.rank === c.rank && Math.abs(o.sig - c.sig) < 10,
    );
    if (closeToExisting) continue;
    seen.add(key);
    out.push({
      rank: c.rank as 3 | 4 | 5,
      sig: c.sig,
      predictedBHR: c.predicted,
      absError: c.absError,
    });
  }
  return out;
}

/**
 * Confidence score [0, 1] from a derived state's absError. Used by the
 * confirmation grid to colour-code rows.
 *
 *   - absError ≤ 30: full confidence (BHR is rounded to nearest 10, three
 *                    rounding steps of slack)
 *   - 30 < absError ≤ 100: medium — likely right but worth a glance
 *   - 100 < absError ≤ 200: low — Tesseract probably misread; user should verify
 *   - > 200: not returned (deriveStateFromBHR returns null)
 */
export function confidenceFromAbsError(absError: number): number {
  if (absError <= 30) return 1;
  if (absError <= 100) return 1 - ((absError - 30) / 70) * 0.4;
  if (absError <= 200) return 0.6 - ((absError - 100) / 100) * 0.4;
  return 0;
}
