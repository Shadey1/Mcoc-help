import type { Champion, ChampionState } from './types.js';
import { calculateBHR } from './bhr.js';

/**
 * Compute champion prestige from a roster: the floor of the average BHR of
 * the top 30 champions (by BHR, descending).
 *
 * Total prestige = champion prestige + relic prestige. v1 only computes the
 * champion side; relic optimisation lives in v2.
 */
export function calculateChampionPrestige(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
): number {
  const bhrs = computeAllBHRs(roster, championLookup);
  const top30 = bhrs.sort((a, b) => b - a).slice(0, 30);
  if (top30.length === 0) return 0;
  const sum = top30.reduce((acc, n) => acc + n, 0);
  return Math.floor(sum / top30.length);
}

/**
 * Return the BHR cutoff for the top-30 — i.e. the BHR of the lowest-ranked
 * champion currently in the top-30. Used for "what could displace it?" reasoning.
 *
 * Returns 0 if the roster has fewer than 30 champions.
 */
export function top30Cutoff(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
): number {
  const sorted = computeAllBHRs(roster, championLookup).sort((a, b) => b - a);
  if (sorted.length < 30) return 0;
  return sorted[29] ?? 0;
}

/**
 * Return the set of champion IDs currently in the top-30 by BHR.
 */
export function getTop30Ids(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
): Set<string> {
  const withBHR = roster.map((state) => {
    const champion = championLookup.get(state.championId);
    if (!champion) throw new Error(`Champion not found: ${state.championId}`);
    return { id: state.championId, bhr: calculateBHR(champion, state) };
  });
  const sorted = withBHR.sort((a, b) => b.bhr - a.bhr).slice(0, 30);
  return new Set(sorted.map((e) => e.id));
}

// ─── Internal helpers ───────────────────────────────────────────────────

function computeAllBHRs(
  roster: ChampionState[],
  championLookup: Map<string, Champion>,
): number[] {
  return roster.map((state) => {
    const champion = championLookup.get(state.championId);
    if (!champion) throw new Error(`Champion not found: ${state.championId}`);
    return calculateBHR(champion, state);
  });
}
