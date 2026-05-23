/**
 * Champion name matching — fuzzy lookup with alias map + Levenshtein.
 *
 * Used by:
 *   - Bulk import (parses user-typed roster lines)
 *   - OCR pipeline (matches OCR'd name to a champion)
 *
 * The matching is layered: exact > starts-with > substring > subsequence
 * > Levenshtein (with length-scaled threshold). Each level produces
 * candidates with a score; we sort all candidates and return the top 5.
 *
 * Alias map handles common community shortcuts (IIM = Iron Man (Infamous),
 * HE = High Evolutionary, etc.) — direct lookup, no fuzzy fallback.
 */

import type { Champion } from '@prestige-tools/engine';

/**
 * Community-vernacular aliases. Keys are normalised (lowercased, alphanum
 * only). Values are exact champion names.
 *
 * Conservative — only abbreviations that are unambiguous in MCOC discourse.
 * Ambiguous abbreviations are NOT included; the fuzzy matcher will return
 * multiple candidates and the user disambiguates.
 */
const ALIASES: Record<string, string> = {
  iim: 'Iron Man (Infamous)',
  he: 'High Evolutionary',
  bwcv: 'Black Widow (Claire Voyant)',
  bwdo: 'Black Widow (Deadly Origin)',
  pavitr: 'Spider-Man (Pavitr Prabhakar)',
  stellarlord: 'Star-Lord (Stellar Forged)',
  starlordsf: 'Star-Lord (Stellar Forged)',
  bpcw: 'Black Panther (Civil War)',
  bpck: 'Black Panther (Civil War)',
  capiw: 'Captain America (Infinity War)',
  capwwii: 'Captain America (WWII)',
  cabucky: 'Captain America (Sam Wilson)',
  dpx23: 'Deadpool X-Force',
  dpxf: 'Deadpool X-Force',
  immortalabom: 'Abomination (Immortal)',
  abomimm: 'Abomination (Immortal)',
  dani: 'Dani Moonstar',
  spiderpunk: 'Spider-Punk',
  spm2099: 'Spider-Man 2099',
  spm: 'Spider-Man',
  ddhk: "Daredevil (Hell's Kitchen)",
  drdoom: 'Doctor Doom',
  drstrange: 'Doctor Strange',
  qs: 'QuickSilver',
  hb: 'Howard the Duck',
  ht: 'Human Torch',
  ss: 'Silver Surfer',
  dp: 'Deadpool',
  ws: 'Winter Soldier',
  bb: 'Black Bolt',
  bc: 'Black Cat',
  cm: 'Captain Marvel',
  cmm: 'Captain Marvel (Movie)',
  ddv: 'Daredevil',
  dd: 'Daredevil',
  drm: 'Doctor Voodoo',
  ag: 'Apocalypse',
  apoc: 'Apocalypse',
  hop: 'Hope Summers',
  mp: 'Madelyne Pryor',
};

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSubsequence(query: string, text: string): boolean {
  if (query.length < 4) return false;
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) prev[i] = i;
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Find candidate champion matches for a free-form name query.
 *
 * Returns up to 5 candidates, sorted by best match first. Tie-broken by
 * shorter name first (so "Spider-Man" wins over "Spider-Man (Variant)"
 * when query is "spiderman").
 *
 * Returns empty array if no plausible matches found.
 */
export function findCandidates(query: string, champions: Champion[]): Champion[] {
  const q = normalize(query);
  if (q.length === 0) return [];

  // Alias map hit — instant return
  const aliasName = ALIASES[q];
  if (aliasName) {
    const aliased = champions.find((c) => c.name === aliasName);
    if (aliased) return [aliased];
  }

  // Score every champion. Lower score = better match.
  // -3 exact, -2 prefix, -1 substring, 0 subsequence, N>0 edit distance
  const scored: Array<{ champion: Champion; score: number }> = [];
  for (const c of champions) {
    const n = normalize(c.name);
    if (n === q) {
      scored.push({ champion: c, score: -3 });
      continue;
    }
    if (n.startsWith(q) || q.startsWith(n)) {
      scored.push({ champion: c, score: -2 });
      continue;
    }
    if (n.includes(q) || q.includes(n)) {
      scored.push({ champion: c, score: -1 });
      continue;
    }
    if (isSubsequence(q, n)) {
      scored.push({ champion: c, score: 0 });
      continue;
    }
    // Typo tolerance scales with query length
    const threshold = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    const dist = levenshtein(q, n);
    if (dist <= threshold) {
      scored.push({ champion: c, score: dist });
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.champion.name.length - b.champion.name.length;
  });

  return scored.slice(0, 5).map((s) => s.champion);
}

/**
 * Pick the auto-resolved champion if there's a clear winner.
 * Returns null if disambiguation is needed.
 */
export function pickAutomatic(query: string, candidates: Champion[]): Champion | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const q = normalize(query);
  const exact = candidates.find((c) => normalize(c.name) === q);
  if (exact) return exact;
  return null;
}
