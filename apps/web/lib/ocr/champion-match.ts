/**
 * Combined champion matching from OCR signals (v0.16.0 rewrite — BHR-first).
 *
 * Each card extracted from a screenshot gives us three independent signals
 * for "who is this champion":
 *
 *   1. BHR (primary). Observed BHR → engine-math reverse search → ranked
 *      list of (champion, state) tuples that produce that BHR within tolerance.
 *      The BHR is a 5-digit number, big and clearly printed, and OCRs cleanly.
 *      The engine math is deterministic. This is the strongest signal.
 *   2. Portrait hash (corroboration). Distance to entries in the user's
 *      confirmed-portrait store. STARTS EMPTY on day 1; builds up as the
 *      user confirms identifications.
 *   3. Name OCR (corroboration). Fuzzy match against champion names. Often
 *      unreliable for game-client screenshots (small yellow text on dark
 *      gradient), but when it works it's a strong corroborator.
 *
 * Identification priority:
 *   - Strong portrait hit (dist ≤ STRONG_PORTRAIT_DIST=8) wins outright — the
 *     user has confirmed THIS portrait before and it's a near-perfect match.
 *   - Otherwise: BHR signal picks the candidate. If portrait or name signals
 *     agree with the top BHR candidate, confidence is boosted.
 *   - Without any BHR signal: fall back to portrait + name only.
 *
 * Agreement classification (used by the confirmation grid for visual cues):
 *   - 'strong'  — BHR + (portrait or name) agree, OR strong portrait hit
 *   - 'partial' — BHR pick is clear but no corroboration, OR portrait/name only
 *   - 'weak'    — multiple BHR candidates within similar error, or no signals
 */

import type { Ascension, Champion } from '@prestige-tools/engine';
import type { MatchResult } from './types';
import type { PortraitStore } from './portrait-store';
import { findClosestInStore } from './portrait-store';
import { confidenceFromDistance } from './phash';
import { findCandidates } from './name-match';
import { findChampionsByBHR } from './bhr-identify';

const STRONG_PORTRAIT_DIST = 8;
const MAX_PORTRAIT_DIST = 16;

export function matchChampion(
  portraitHash: string,
  nameText: string | null,
  observedBHR: number | null,
  ascensionHint: Ascension | null,
  champions: Champion[],
  portraitStore: PortraitStore,
): MatchResult {
  // ── Gather all three signals ──────────────────────────────────────────
  const bhrCandidates = observedBHR
    ? findChampionsByBHR(observedBHR, ascensionHint, champions)
    : [];
  const portraitMatches = findClosestInStore(
    portraitHash,
    portraitStore,
    MAX_PORTRAIT_DIST,
    5,
  );
  const nameCandidates = nameText ? findCandidates(nameText, champions) : [];

  const championById = new Map(champions.map((c) => [c.id, c]));
  const getChampion = (id: string): Champion | null =>
    championById.get(id) ?? null;

  // ── Strong portrait wins unconditionally ──────────────────────────────
  // If the user has confirmed THIS exact champion's portrait before and the
  // distance is tight, that's the most reliable signal we can have.
  const strongPortrait = portraitMatches.find(
    (p) => p.distance <= STRONG_PORTRAIT_DIST,
  );
  if (strongPortrait) {
    const c = getChampion(strongPortrait.championId);
    if (c) {
      const bhrBacks = bhrCandidates.some((b) => b.championId === c.id);
      return {
        championId: c.id,
        championName: c.name,
        confidence: bhrBacks ? 0.95 : 0.85,
        agreement: bhrBacks ? 'strong' : 'partial',
        alternatives: mergeAlternatives(
          portraitMatches.filter((p) => p.championId !== c.id),
          bhrCandidates.filter((b) => b.championId !== c.id),
          nameCandidates.filter((n) => n.id !== c.id),
          getChampion,
        ),
      };
    }
  }

  // ── BHR signal is the next strongest ──────────────────────────────────
  if (bhrCandidates.length > 0) {
    const top = bhrCandidates[0]!;
    const portraitBacks = portraitMatches.some(
      (p) => p.championId === top.championId,
    );
    const nameBacks = nameCandidates.some((n) => n.id === top.championId);
    const corroborated = portraitBacks || nameBacks;

    // Tight match (absError < 30) + corroboration → strong
    // Tight match alone → partial (BHR is reliable but unsolo'd)
    // Looser match → weak (multiple candidates likely)
    const isTight = top.absError < 30;
    const next = bhrCandidates[1];
    const isUnique = !next || next.absError - top.absError > 50;

    let confidence: number;
    let agreement: 'strong' | 'partial' | 'weak';
    if (corroborated) {
      confidence = 0.9;
      agreement = 'strong';
    } else if (isTight && isUnique) {
      confidence = 0.75;
      agreement = 'partial';
    } else if (isTight) {
      confidence = 0.65;
      agreement = 'partial';
    } else {
      confidence = 0.55;
      agreement = 'weak';
    }

    return {
      championId: top.championId,
      championName: top.championName,
      confidence,
      agreement,
      alternatives: mergeAlternatives(
        portraitMatches.filter((p) => p.championId !== top.championId),
        bhrCandidates.slice(1),
        nameCandidates.filter((n) => n.id !== top.championId),
        getChampion,
      ),
    };
  }

  // ── No BHR. Fall back to portrait + name ──────────────────────────────
  // (Same logic as the previous champion-match.ts when BHR wasn't available.)

  // Weak portrait + name agree → partial
  if (portraitMatches.length > 0 && nameCandidates.length > 0) {
    const topPortrait = portraitMatches[0]!;
    const topName = nameCandidates[0]!;
    if (topPortrait.championId === topName.id) {
      return {
        championId: topName.id,
        championName: topName.name,
        confidence: 0.7,
        agreement: 'partial',
        alternatives: mergeAlternatives(
          portraitMatches.slice(1),
          [],
          nameCandidates.slice(1),
          getChampion,
        ),
      };
    }
    // Disagreement — trust name (text is more reliable than visual at weak dist)
    return {
      championId: topName.id,
      championName: topName.name,
      confidence: 0.45,
      agreement: 'weak',
      alternatives: mergeAlternatives(
        portraitMatches,
        [],
        nameCandidates.slice(1),
        getChampion,
      ),
    };
  }

  // Only portrait
  if (portraitMatches.length > 0) {
    const top = portraitMatches[0]!;
    const c = getChampion(top.championId);
    if (c) {
      return {
        championId: c.id,
        championName: c.name,
        confidence: confidenceFromDistance(top.distance) * 0.5,
        agreement: 'weak',
        alternatives: mergeAlternatives(
          portraitMatches.slice(1),
          [],
          [],
          getChampion,
        ),
      };
    }
  }

  // Only name
  if (nameCandidates.length > 0) {
    const top = nameCandidates[0]!;
    return {
      championId: top.id,
      championName: top.name,
      confidence: 0.5,
      agreement: 'weak',
      alternatives: mergeAlternatives(
        [],
        [],
        nameCandidates.slice(1),
        getChampion,
      ),
    };
  }

  return weakMatch();
}

function mergeAlternatives(
  portraitAlts: Array<{ championId: string; distance: number }>,
  bhrAlts: Array<{ championId: string; championName: string; absError: number }>,
  nameAlts: Array<{ id: string; name: string }>,
  getChampion: (id: string) => Champion | null,
): MatchResult['alternatives'] {
  const seen = new Set<string>();
  const out: MatchResult['alternatives'] = [];

  // BHR alts first — they're the most semantically relevant
  for (const b of bhrAlts) {
    if (seen.has(b.championId)) continue;
    seen.add(b.championId);
    out.push({
      championId: b.championId,
      championName: b.championName,
      score: 1 - b.absError / 200,
    });
  }
  // Portrait alts second
  for (const p of portraitAlts) {
    if (seen.has(p.championId)) continue;
    const c = getChampion(p.championId);
    if (!c) continue;
    seen.add(p.championId);
    out.push({
      championId: c.id,
      championName: c.name,
      score: confidenceFromDistance(p.distance),
    });
  }
  // Name alts last
  for (const n of nameAlts) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push({
      championId: n.id,
      championName: n.name,
      score: 0.5,
    });
  }
  return out.slice(0, 6);
}

function weakMatch(): MatchResult {
  return {
    championId: '',
    championName: '',
    confidence: 0,
    agreement: 'weak',
    alternatives: [],
  };
}
