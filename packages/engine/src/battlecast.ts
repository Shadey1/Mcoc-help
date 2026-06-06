/**
 * Battlecast relic prestige — 6★ catalogue. v2 scope.
 *
 * Battlecasts are champion-bound relics; unlike statcasts, the prestige
 * curve is per-relic (each battlecast has its own table). The 6★ tier is
 * the only one we model for now — older 3/4/5★ tiers are out of scope
 * until there's demand from rosters that use them.
 *
 * State model: indexed by (rank, sig) where rank is R1..R5 and sig is
 * an integer 0..200. Sig is an independent axis from rank; the "Lvl" the
 * in-game UI shows is just rank × 10 (display only, not stored).
 *
 * Data: each catalogued battlecast has one or more `verified` anchors at
 * specific (rank, sig, rating) tuples from in-game captures. No
 * interpolation between anchors — battlecast curves are per-relic with
 * no shared shape; battlecast6Rating returns null for any state without
 * a verified anchor at the exact (rank, sig).
 *
 * History note: an earlier version of this catalogue carried a
 * `mcochubAnchor` field with values from MCOCHUB's community ranking
 * page. Cross-checking against verified captures showed those values
 * were a stale snapshot of one summoner's roster at one moment, not a
 * normalised reference — 22/25 had drifted from the current state.
 * Dropped to avoid misleading callers.
 *
 * The 7★ tier of these same relics lives in src/relics/seed.ts under
 * the SPECIALS map (Cosmic Egg only at present).
 */

import type { RelicRank } from './relic.js';

/** Stable id for each catalogued 6★ battlecast. Sourced from the Fandom
 *  wiki's full battlecast page list (24 named battlecasts + Cosmic Egg).
 *  Class assignments are best-guess from each named champion's typical
 *  MCOC class — relic class is metadata only (doesn't affect prestige
 *  math), so wrong guesses are fixable without engine impact. */
export type Battlecast6Id =
  | 'cosmic-egg'
  | 'ant-man'
  | 'black-panther'
  | 'black-widow'
  | 'captain-america-wwii'
  | 'gambit'
  | 'gamora'
  | 'ghost-rider'
  | 'green-goblin'
  | 'hulk'
  | 'hulkbuster'
  | 'iron-fist'
  | 'juggernaut'
  | 'mister-sinister'
  | 'ms-marvel'
  | 'scarlet-witch'
  | 'sentinel'
  | 'spider-man-2099'
  | 'storm'
  | 'thor'
  | 'valkyrie'
  | 'venom'
  | 'vision'
  | 'winter-soldier'
  | 'wolverine';

export const BATTLECAST_6STAR_IDS: readonly Battlecast6Id[] = [
  'cosmic-egg',
  'ant-man',
  'black-panther',
  'black-widow',
  'captain-america-wwii',
  'gambit',
  'gamora',
  'ghost-rider',
  'green-goblin',
  'hulk',
  'hulkbuster',
  'iron-fist',
  'juggernaut',
  'mister-sinister',
  'ms-marvel',
  'scarlet-witch',
  'sentinel',
  'spider-man-2099',
  'storm',
  'thor',
  'valkyrie',
  'venom',
  'vision',
  'winter-soldier',
  'wolverine',
] as const;

export type Battlecast6Class =
  | 'Cosmic'
  | 'Mutant'
  | 'Mystic'
  | 'Science'
  | 'Skill'
  | 'Tech';

export type Battlecast6Def = {
  id: Battlecast6Id;
  /** Human-readable relic name (e.g. "The Cosmic Egg"). */
  name: string;
  /** Relic class (constrains which champions can equip it). */
  class: Battlecast6Class;
  /**
   * Champion IDs that this battlecast binds to. Sourced from MCOCHUB's
   * relics catalogue. Empty array if compatibility is uncertain.
   */
  boundChampions: readonly string[];
  /**
   * Verified prestige anchors from direct in-game readings. Sparse —
   * only populated where someone has captured the exact value at a
   * specific (rank, sig). Sig is an integer 0..200 (game accepts per-1
   * stones; most readings land on 20-step brackets but not all).
   */
  verified: ReadonlyArray<{
    rank: RelicRank;
    sig: number;
    rating: number;
  }>;
};

/**
 * 6★ battlecast catalogue. Verified anchors come from in-game captures.
 *
 * Adding a battlecast: extend `Battlecast6Id`, add a row here, optionally
 * back-fill `verified` once a capture lands. Adding a verified value:
 * append to `verified` with the (rank, sig, rating) tuple.
 */
export const BATTLECAST_6STAR_CATALOG: Record<Battlecast6Id, Battlecast6Def> = {
  'cosmic-egg': {
    id: 'cosmic-egg',
    name: 'The Cosmic Egg',
    class: 'Cosmic',
    boundChampions: ['venom-the-duck'],
    verified: [{ rank: 'R5', sig: 200, rating: 3060 }],
  },
  'ant-man': {
    id: 'ant-man',
    name: 'Ant-Man',
    class: 'Tech',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 80, rating: 1414 }],
  },
  'black-panther': {
    id: 'black-panther',
    name: 'Black Panther',
    class: 'Skill',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 60, rating: 1360 }],
  },
  'black-widow': {
    id: 'black-widow',
    name: 'Black Widow',
    class: 'Skill',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 40, rating: 1315 }],
  },
  'captain-america-wwii': {
    id: 'captain-america-wwii',
    name: 'Captain America (WWII)',
    class: 'Skill',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 200, rating: 2265 }],
  },
  gambit: {
    id: 'gambit',
    name: 'Gambit',
    class: 'Mutant',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 200, rating: 2236 }],
  },
  gamora: {
    id: 'gamora',
    name: 'Gamora',
    class: 'Cosmic',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 41, rating: 1324 }],
  },
  'ghost-rider': {
    id: 'ghost-rider',
    name: 'Ghost Rider',
    class: 'Cosmic',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 100, rating: 1470 }],
  },
  'green-goblin': {
    id: 'green-goblin',
    name: 'Green Goblin',
    class: 'Tech',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 140, rating: 2107 }],
  },
  hulk: {
    id: 'hulk',
    name: 'Hulk',
    class: 'Science',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 40, rating: 1309 }],
  },
  hulkbuster: {
    id: 'hulkbuster',
    name: 'Hulkbuster',
    class: 'Tech',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 80, rating: 1415 }],
  },
  'iron-fist': {
    id: 'iron-fist',
    name: 'Iron Fist',
    class: 'Mystic',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 200, rating: 2266 }],
  },
  juggernaut: {
    id: 'juggernaut',
    name: 'Juggernaut',
    class: 'Mutant',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 80, rating: 1416 }],
  },
  'mister-sinister': {
    id: 'mister-sinister',
    name: 'Mister Sinister',
    class: 'Mutant',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 180, rating: 2213 }],
  },
  'ms-marvel': {
    id: 'ms-marvel',
    name: 'Ms. Marvel',
    class: 'Cosmic',
    boundChampions: [],
    verified: [{ rank: 'R3', sig: 120, rating: 1786 }],
  },
  'scarlet-witch': {
    id: 'scarlet-witch',
    name: 'Scarlet Witch',
    class: 'Mystic',
    boundChampions: [],
    verified: [{ rank: 'R1', sig: 61, rating: 1102 }],
  },
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    class: 'Tech',
    boundChampions: [],
    verified: [{ rank: 'R2', sig: 60, rating: 1364 }],
  },
  'spider-man-2099': {
    id: 'spider-man-2099',
    name: 'Spider-Man 2099',
    class: 'Science',
    boundChampions: [
      'ant-man',
      'cassie-lang',
      'hulk-ragnarok',
      'mister-fantastic',
      'quicksilver',
      'scorpion',
      'spider-gwen',
      'spider-ham',
      'spider-man-miles-morales',
      'spider-man-2099',
      'spider-man',
      'the-overseer',
      'titania',
      'sentry',
      'she-hulk-deathless',
      'spider-punk',
      'the-leader',
      'lizard',
    ],
    verified: [{ rank: 'R4', sig: 200, rating: 2283 }],
  },
  storm: {
    id: 'storm',
    name: 'Storm',
    class: 'Mutant',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 200, rating: 2264 }],
  },
  thor: {
    id: 'thor',
    name: 'Thor',
    class: 'Cosmic',
    boundChampions: [],
    verified: [{ rank: 'R3', sig: 100, rating: 1735 }],
  },
  valkyrie: {
    id: 'valkyrie',
    name: 'Valkyrie',
    class: 'Mystic',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 200, rating: 2263 }],
  },
  venom: {
    id: 'venom',
    name: 'Venom',
    class: 'Cosmic',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 120, rating: 2049 }],
  },
  vision: {
    id: 'vision',
    name: 'Vision',
    class: 'Tech',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 120, rating: 2050 }],
  },
  'winter-soldier': {
    id: 'winter-soldier',
    name: 'Winter Soldier',
    class: 'Skill',
    boundChampions: [],
    verified: [{ rank: 'R4', sig: 120, rating: 2025 }],
  },
  wolverine: {
    id: 'wolverine',
    name: 'Wolverine',
    class: 'Mutant',
    boundChampions: [],
    verified: [{ rank: 'R3', sig: 100, rating: 1738 }],
  },
};

export type Battlecast6Rating = { rating: number; source: 'verified' };

/**
 * Look up a 6★ battlecast's rating at (rank, sig).
 *
 *   - Returns `source: 'verified'` when an exact anchor match exists.
 *   - Returns null otherwise. No fallback / extrapolation — battlecast
 *     curves are per-relic with no shared shape, so guessing across
 *     states would mislead. Callers display "—" or invite submissions.
 *
 * Sig is an integer 0..200. The game accepts per-1 sig stones; most
 * relics land on 20-step brackets but not all (rare awakening-gem +
 * partial sig combos produce values like sig 41 or sig 61).
 */
export function battlecast6Rating(
  id: Battlecast6Id,
  rank: RelicRank,
  sig: number,
): Battlecast6Rating | null {
  const def = BATTLECAST_6STAR_CATALOG[id];
  if (!def) return null;
  for (const v of def.verified) {
    if (v.rank === rank && v.sig === sig) {
      return { rating: v.rating, source: 'verified' };
    }
  }
  return null;
}
