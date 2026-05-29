/**
 * BHR-first global assignment of champions to BHR observations.
 *
 * Pure logic (no canvas/OCR), so it's unit-testable in Node. The seeder feeds
 * it deduped BHR observations (value + optional name/ascension hints) and gets
 * back a one-to-one assignment of champions.
 *
 * Identification is BHR-FIRST: each observation's BHR value is matched against
 * the engine math (`findChampionsByBHR`). The spatially-nearest OCR'd name is a
 * corroboration signal, not a hard pairing — see portrait-seeder for why that
 * matters (device-independence).
 *
 * Two subtleties this module exists to handle correctly:
 *
 *  1. `findChampionsByBHR` returns only its top-N candidates by BHR error. In
 *     the dense low-BHR range, 10+ champions tie at error 0, so the truly-owned
 *     champion can fall outside the top-N. When a name hint is present we
 *     therefore derive that champion's own candidate explicitly and inject it,
 *     so corroboration is a HARD signal that can't be truncated away.
 *
 *  2. At max state (R5 A2 sig200) almost every champion produces ~the same top
 *     BHR, so a single high value matches dozens of champions. The one-to-one
 *     greedy assignment + corroboration-first ordering resolves this: each
 *     champion is claimed once, and name-corroborated matches sort ahead of all
 *     uncorroborated ones, locking the right champion to its real BHR before
 *     any uncorroborated fallback can steal it.
 */

import type { Ascension, Champion } from '@prestige-tools/engine';
import { findChampionsByBHR, type BHRCandidate } from './bhr-identify';
import { deriveStateFromBHR } from './bhr-reverse';

export type BhrObservationInput = {
  value: number;
  /** championId of the OCR'd name spatially above this BHR, if any. */
  nameHintId: string | null;
  ascHint: Ascension | null;
};

export type BhrAssignment = {
  obsIndex: number;
  championId: string;
  championName: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: Ascension;
  absError: number;
  /** true when the assignment matched the observation's OCR'd name hint. */
  corroborated: boolean;
};

/** BHR error budget for candidate generation. Wider than the prestige page's
 *  default because My Champions spans lower BHR ranges with more model spread.
 *  Name corroboration + the one-to-one constraint keep false positives down. */
export const IDENTIFY_TOLERANCE = 200;

/** Subtracted from a candidate's BHR error when it matches the observation's
 *  name hint. Large enough that every corroborated match sorts ahead of every
 *  uncorroborated one, regardless of error. */
const NAME_BONUS = 100000;

/** A candidate is "tight" to the observed BHR within this many points (BHR is
 *  rounded to the nearest 10 in-game; OCR is good to ±10-20). An observation
 *  with no readable name is only assignable when EXACTLY ONE champion is tight
 *  to it — i.e. the BHR alone pins the identity. When several champions are
 *  tight (the whole roster collapses near max BHR), a name-less card is a coin
 *  flip, so we drop it rather than import an arbitrary same-BHR champion. */
const DISCRIMINATING_BAND = 40;

/**
 * Derive the hinted champion's own best candidate for this BHR, bypassing the
 * top-N truncation in findChampionsByBHR. Returns null if the champion can't
 * produce the BHR within tolerance (i.e. the name/BHR pairing is implausible).
 */
function deriveHintedCandidate(
  champ: Champion,
  value: number,
  ascHint: Ascension | null,
): BHRCandidate | null {
  const ascensions: Ascension[] = ascHint
    ? [ascHint]
    : champ.ascendable
      ? ['A0', 'A1', 'A2']
      : ['A0'];

  let best: BHRCandidate | null = null;
  for (const asc of ascensions) {
    const d = deriveStateFromBHR(champ, value, asc, IDENTIFY_TOLERANCE);
    if (d && (!best || d.absError < best.absError)) {
      best = {
        championId: champ.id,
        championName: champ.name,
        rank: d.rank,
        sig: d.sig,
        ascension: d.ascension,
        predicted: d.predictedBHR,
        absError: d.absError,
      };
    }
  }
  return best;
}

export function assignChampionsByBHR(
  observations: BhrObservationInput[],
  champions: Champion[],
): BhrAssignment[] {
  const champLookup = new Map(champions.map((c) => [c.id, c]));

  type Scored = {
    oi: number;
    candidate: BHRCandidate;
    effError: number;
    corroborated: boolean;
  };
  const scored: Scored[] = [];

  // Per-observation: can a name-less card be trusted to the BHR alone? True
  // only when exactly one champion sits tight to the observed value.
  const discriminating: boolean[] = [];

  observations.forEach((obs, oi) => {
    const list = findChampionsByBHR(
      obs.value,
      obs.ascHint,
      champions,
      IDENTIFY_TOLERANCE,
    );

    discriminating[oi] =
      list.filter((c) => c.absError <= DISCRIMINATING_BAND).length === 1;

    // Guarantee the hinted champion is considered even if it fell outside the
    // top-N by BHR error (common in the dense low-BHR range).
    if (obs.nameHintId && !list.some((c) => c.championId === obs.nameHintId)) {
      const champ = champLookup.get(obs.nameHintId);
      if (champ) {
        const hinted = deriveHintedCandidate(champ, obs.value, obs.ascHint);
        if (hinted) list.push(hinted);
      }
    }

    for (const candidate of list) {
      const corroborated = candidate.championId === obs.nameHintId;
      scored.push({
        oi,
        candidate,
        effError: candidate.absError - (corroborated ? NAME_BONUS : 0),
        corroborated,
      });
    }
  });

  scored.sort((a, b) => a.effError - b.effError);

  const usedObs = new Set<number>();
  const usedChamp = new Set<string>();
  const result: BhrAssignment[] = [];
  for (const s of scored) {
    if (usedObs.has(s.oi) || usedChamp.has(s.candidate.championId)) continue;
    // A name-less card is only trustworthy when its BHR uniquely pins one
    // champion. Otherwise drop it — better absent than an arbitrary phantom.
    if (!s.corroborated && !discriminating[s.oi]) continue;
    usedObs.add(s.oi);
    usedChamp.add(s.candidate.championId);
    result.push({
      obsIndex: s.oi,
      championId: s.candidate.championId,
      championName: s.candidate.championName,
      rank: s.candidate.rank,
      sig: s.candidate.sig,
      ascension: s.candidate.ascension,
      absError: s.candidate.absError,
      corroborated: s.corroborated,
    });
  }
  return result;
}
