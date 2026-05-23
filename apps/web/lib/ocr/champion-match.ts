/**
 * Combined champion matching from OCR signals.
 *
 * Each card extracted from a screenshot gives us two independent signals
 * for "who is this champion":
 *
 *   1. Portrait hash (aHash of the portrait region) → distance to each of
 *      our 254 reference portraits → list of candidates by visual similarity
 *   2. Name OCR → fuzzy name match → list of candidates by string similarity
 *
 * Either signal alone can fail: portrait can be misidentified due to
 * compression artifacts; name OCR can be illegible. Combining them gives
 * robustness — if both signals agree, we have a strong match; if they
 * disagree, we flag for user review.
 *
 * Confidence semantics:
 *   - 'strong'  — portrait and name agree on the same champion. Auto-accept.
 *   - 'partial' — they disagree but the right answer is somewhere in both
 *                 candidate lists. We pick the best-supported one but flag.
 *   - 'weak'    — only one signal available, OR signals contradict and
 *                 there's no overlap. User review essential.
 */

import type { Champion } from '@prestige-tools/engine';
import type { MatchResult, PortraitHashTable } from './types';
import { findClosestPortrait, confidenceFromDistance } from './phash';
import { findCandidates } from './name-match';

export function matchChampion(
  portraitHash: string,
  nameText: string | null,
  champions: Champion[],
  portraitLibrary: PortraitHashTable,
): MatchResult {
  // Portrait signal
  const portraitMatches = findClosestPortrait(
    portraitHash,
    portraitLibrary.hashes,
    20, // tolerate distance up to 20 here; we'll filter on confidence later
    5,
  );

  // Name signal
  const nameCandidates = nameText ? findCandidates(nameText, champions) : [];

  // Lookup helper
  const championById = new Map(champions.map((c) => [c.id, c]));
  const getChampion = (id: string): Champion | null => championById.get(id) ?? null;

  // ── Case 1: Both signals empty — nothing to work with ──
  if (portraitMatches.length === 0 && nameCandidates.length === 0) {
    return {
      championId: '',
      championName: '',
      confidence: 0,
      agreement: 'weak',
      alternatives: [],
    };
  }

  // ── Case 2: Only portrait signal available ──
  if (portraitMatches.length > 0 && nameCandidates.length === 0) {
    const top = portraitMatches[0]!;
    const c = getChampion(top.championId);
    if (!c) return weakMatch();
    return {
      championId: c.id,
      championName: c.name,
      confidence: confidenceFromDistance(top.distance) * 0.7, // single-signal penalty
      agreement: 'weak',
      alternatives: portraitMatches.slice(1).map((m) => ({
        championId: m.championId,
        championName: getChampion(m.championId)?.name ?? '?',
        score: confidenceFromDistance(m.distance),
      })),
    };
  }

  // ── Case 3: Only name signal available ──
  if (portraitMatches.length === 0 && nameCandidates.length > 0) {
    const top = nameCandidates[0]!;
    return {
      championId: top.id,
      championName: top.name,
      confidence: 0.6, // moderate — name OCR alone is noisy
      agreement: 'weak',
      alternatives: nameCandidates.slice(1).map((c) => ({
        championId: c.id,
        championName: c.name,
        score: 0.5,
      })),
    };
  }

  // ── Case 4: Both signals present ──
  const topPortrait = portraitMatches[0]!;
  const topName = nameCandidates[0]!;

  // Strong agreement
  if (topPortrait.championId === topName.id) {
    const portraitConf = confidenceFromDistance(topPortrait.distance);
    return {
      championId: topName.id,
      championName: topName.name,
      confidence: Math.min(1, portraitConf + 0.3), // bonus for agreement
      agreement: 'strong',
      alternatives: mergeAlternatives(
        portraitMatches.slice(1),
        nameCandidates.slice(1),
        getChampion,
      ),
    };
  }

  // Partial — top portrait appears in name candidates (or vice versa)
  const portraitInName = nameCandidates.find((c) => c.id === topPortrait.championId);
  const nameInPortrait = portraitMatches.find((p) => p.championId === topName.id);

  if (portraitInName) {
    // Portrait's top pick is also in name's list — go with portrait
    const c = getChampion(topPortrait.championId)!;
    return {
      championId: c.id,
      championName: c.name,
      confidence: confidenceFromDistance(topPortrait.distance) * 0.8,
      agreement: 'partial',
      alternatives: mergeAlternatives(
        portraitMatches.slice(1),
        nameCandidates.filter((nc) => nc.id !== c.id),
        getChampion,
      ),
    };
  }

  if (nameInPortrait) {
    // Name's top pick is in portrait's list — go with name
    return {
      championId: topName.id,
      championName: topName.name,
      confidence: 0.7,
      agreement: 'partial',
      alternatives: mergeAlternatives(
        portraitMatches.filter((pm) => pm.championId !== topName.id),
        nameCandidates.slice(1),
        getChampion,
      ),
    };
  }

  // ── Weak: signals disagree and no overlap ──
  // Use portrait as primary (visual signal is usually more reliable than
  // noisy OCR), but flag clearly for user review.
  const c = getChampion(topPortrait.championId)!;
  return {
    championId: c.id,
    championName: c.name,
    confidence: confidenceFromDistance(topPortrait.distance) * 0.5,
    agreement: 'weak',
    alternatives: mergeAlternatives(
      portraitMatches.slice(1),
      nameCandidates,
      getChampion,
    ),
  };
}

function mergeAlternatives(
  portraitAlts: Array<{ championId: string; distance: number }>,
  nameAlts: Array<{ id: string; name: string }>,
  getChampion: (id: string) => Champion | null,
): MatchResult['alternatives'] {
  const seen = new Set<string>();
  const out: MatchResult['alternatives'] = [];
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
