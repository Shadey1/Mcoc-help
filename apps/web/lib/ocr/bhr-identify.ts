/**
 * BHR-based champion identification.
 *
 * Given an observed BHR from OCR, search the engine math across every
 * (champion, rank, sig, ascension) tuple and return the ones whose computed
 * BHR matches within tolerance. Output is sorted by absolute error.
 *
 * This is the v0.16.0 primary identification signal. Earlier approaches
 * relied on name OCR (broken for yellow-on-gradient game-client text) and
 * portrait hashing (needs a populated user library). BHR identification
 * works on day 1 with zero prior data: the OCR pipeline reads a 5-digit
 * number cleanly, and the engine math is deterministic.
 *
 * Search space: ~254 champions × 3 reachable ranks × 3 ascensions × 41 sig
 * values (sampled at every 5) = ~94k evaluations per card. At ~1μs each
 * that's ~100ms per card — slow but tolerable for a 30-card screenshot,
 * runs once per import.
 *
 * Why this works: BHR is dense across the champion roster but specific
 * values are usually unique to one (champion, state) tuple. The engine
 * math is monotonic in sig within a (rank, ascension) and rank levels
 * barely overlap, so a noisy BHR observation lands decisively close to
 * one candidate.
 *
 * Caveat: when two champions can produce the same BHR within tolerance
 * (e.g. close baseline BHRs at the same rank), the function returns both
 * as alternatives. The confirmation grid surfaces this for user picking.
 */

import type { Ascension, Champion } from '@prestige-tools/engine';
import { calculateBHR } from '@prestige-tools/engine';

export type BHRCandidate = {
  championId: string;
  championName: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: Ascension;
  predicted: number;
  absError: number;
};

/** Within this many BHR points of observed → counts as a match.
 *  BHR OCR is accurate to ±10-20 (large white digits). 50 gives ample
 *  margin while cutting false positives in the dense 33k-38k range. */
const ACCEPT_TOLERANCE = 50;

/** Sample sig at this resolution. Real player sigs land on multiples of 10. */
const SIG_STEP = 5;

/** Max candidates returned. More alternatives feed the greedy assignment. */
const MAX_CANDIDATES = 10;

/**
 * Find candidate (champion, state) tuples whose computed BHR matches the
 * observed BHR within tolerance. Deduped to one entry per champion (best match).
 *
 * @param observedBHR BHR read from screenshot
 * @param ascensionHint Visual ascension reading (A0/A1/A2) — used as a soft
 *   preference, not a hard filter. Pass null when visual detection is unreliable.
 */
export function findChampionsByBHR(
  observedBHR: number,
  ascensionHint: Ascension | null,
  champions: Champion[],
): BHRCandidate[] {
  const allMatches: BHRCandidate[] = [];

  for (const champion of champions) {
    for (const rank of [5, 4, 3] as const) {
      const ascensions: Ascension[] = champion.ascendable
        ? ['A0', 'A1', 'A2']
        : ['A0'];

      for (const asc of ascensions) {
        try {
          // Quick-reject: check sig 0 and sig 200 to see if any sig in this
          // (rank, ascension) range could land near observedBHR
          const at0 = calculateBHR(champion, {
            championId: champion.id,
            rank,
            sig: 0,
            ascension: asc,
            stateConfirmed: false,
            addedVia: 'screenshot',
          });
          const at200 = calculateBHR(champion, {
            championId: champion.id,
            rank,
            sig: 200,
            ascension: asc,
            stateConfirmed: false,
            addedVia: 'screenshot',
          });
          const lo = Math.min(at0, at200);
          const hi = Math.max(at0, at200);
          if (observedBHR < lo - ACCEPT_TOLERANCE || observedBHR > hi + ACCEPT_TOLERANCE) {
            continue; // skip this (rank, asc) — observed BHR can't be in range
          }

          // Detailed sweep across sig values
          let bestForThisRankAsc: BHRCandidate | null = null;
          for (let sig = 0; sig <= 200; sig += SIG_STEP) {
            const predicted = calculateBHR(champion, {
              championId: champion.id,
              rank,
              sig,
              ascension: asc,
              stateConfirmed: false,
              addedVia: 'screenshot',
            });
            const absError = Math.abs(predicted - observedBHR);
            if (absError > ACCEPT_TOLERANCE) continue;
            if (!bestForThisRankAsc || absError < bestForThisRankAsc.absError) {
              bestForThisRankAsc = {
                championId: champion.id,
                championName: champion.name,
                rank,
                sig,
                ascension: asc,
                predicted,
                absError,
              };
            }
          }
          if (bestForThisRankAsc) allMatches.push(bestForThisRankAsc);
        } catch {
          // Rank/state combo unsupported by this champion — skip silently
        }
      }
    }
  }

  // Apply ascension-hint preference: when multiple candidates per champion
  // exist, prefer the one matching the visual hint (if provided)
  const bestByChampion = new Map<string, BHRCandidate>();
  for (const m of allMatches) {
    const existing = bestByChampion.get(m.championId);
    if (!existing) {
      bestByChampion.set(m.championId, m);
      continue;
    }
    // Score: lower absError is better; matching the hint adds a -25 bonus
    const score = (c: BHRCandidate) =>
      c.absError - (ascensionHint && c.ascension === ascensionHint ? 25 : 0);
    if (score(m) < score(existing)) {
      bestByChampion.set(m.championId, m);
    }
  }

  return Array.from(bestByChampion.values())
    .sort((a, b) => a.absError - b.absError)
    .slice(0, MAX_CANDIDATES);
}
