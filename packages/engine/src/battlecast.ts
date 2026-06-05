/**
 * Battlecast relic prestige — 6★ catalogue. v2 scope.
 *
 * Battlecasts are champion-bound relics; unlike statcasts, the prestige
 * curve is per-relic (each battlecast has its own table). The 6★ tier is
 * the only one we model for now — older 3/4/5★ tiers are out of scope
 * until there's demand from rosters that use them.
 *
 * State model mirrors the 6★ statcast module: indexed by (rank, sig)
 * where rank is R1..R5 and sig is 0..200 in 20-step brackets. Sig is an
 * independent axis from rank; the "Lvl" the in-game UI shows is just
 * rank × 10 (display only, not stored).
 *
 * Data state right now:
 *   - Cosmic Egg has ONE user-verified anchor (R5 sig 200 = 3060 from a
 *     direct in-game capture).
 *   - Every catalogued battlecast also has a single MCOCHUB ranking
 *     value, attributed to R1 sig 0 as a best-guess state. These are
 *     alpha-flagged — the actual state MCOCHUB uses for its ranking is
 *     not documented anywhere we could find.
 *   - Everything else returns null. The UI surface (catalogue + submit
 *     form) lets users fill in gaps.
 *
 * The 7★ tier of these same relics already lives in src/relics/seed.ts
 * under the SPECIALS map (Cosmic Egg only at present). When that module
 * gets refreshed with the (rank, sig) terminology lock-in, the two
 * modules will share more structure.
 */

import type { LevelBracket, RelicRank } from './relic.js';

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
   * specific (rank, sig).
   */
  verified: ReadonlyArray<{
    rank: RelicRank;
    sig: LevelBracket;
    rating: number;
  }>;
  /**
   * MCOCHUB community-ranking value. Single number per relic at an
   * unspecified state; we attribute it to R1 sig 0 as the most common
   * normalisation point used by community ranking pages. Treated as
   * alpha. null if MCOCHUB has no value for this relic.
   */
  mcochubAnchor: number | null;
};

/**
 * 6★ battlecast catalogue. MCOCHUB anchor values from
 * https://mcochub.insaneskull.com/relics (community-maintained ranking).
 * Verified anchors come from user-submitted in-game captures.
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
    mcochubAnchor: 2740,
  },
  'ant-man': {
    id: 'ant-man',
    name: 'Ant-Man',
    class: 'Tech',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 2262,
  },
  'black-panther': {
    id: 'black-panther',
    name: 'Black Panther',
    class: 'Skill',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 1996,
  },
  'black-widow': {
    id: 'black-widow',
    name: 'Black Widow',
    class: 'Skill',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 2266,
  },
  'captain-america-wwii': {
    id: 'captain-america-wwii',
    name: 'Captain America (WWII)',
    class: 'Skill',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  gambit: {
    id: 'gambit',
    name: 'Gambit',
    class: 'Mutant',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 2269,
  },
  gamora: {
    id: 'gamora',
    name: 'Gamora',
    class: 'Cosmic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 2275,
  },
  'ghost-rider': {
    id: 'ghost-rider',
    name: 'Ghost Rider',
    class: 'Cosmic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'green-goblin': {
    id: 'green-goblin',
    name: 'Green Goblin',
    class: 'Tech',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  hulk: {
    id: 'hulk',
    name: 'Hulk',
    class: 'Science',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  hulkbuster: {
    id: 'hulkbuster',
    name: 'Hulkbuster',
    class: 'Tech',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'iron-fist': {
    id: 'iron-fist',
    name: 'Iron Fist',
    class: 'Mystic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  juggernaut: {
    id: 'juggernaut',
    name: 'Juggernaut',
    class: 'Mutant',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'mister-sinister': {
    id: 'mister-sinister',
    name: 'Mister Sinister',
    class: 'Mutant',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'ms-marvel': {
    id: 'ms-marvel',
    name: 'Ms. Marvel',
    class: 'Cosmic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'scarlet-witch': {
    id: 'scarlet-witch',
    name: 'Scarlet Witch',
    class: 'Mystic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    class: 'Tech',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
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
    verified: [],
    mcochubAnchor: 2283,
  },
  storm: {
    id: 'storm',
    name: 'Storm',
    class: 'Mutant',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  thor: {
    id: 'thor',
    name: 'Thor',
    class: 'Cosmic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  valkyrie: {
    id: 'valkyrie',
    name: 'Valkyrie',
    class: 'Mystic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  venom: {
    id: 'venom',
    name: 'Venom',
    class: 'Cosmic',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  vision: {
    id: 'vision',
    name: 'Vision',
    class: 'Tech',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  'winter-soldier': {
    id: 'winter-soldier',
    name: 'Winter Soldier',
    class: 'Skill',
    boundChampions: [],
    verified: [],
    mcochubAnchor: null,
  },
  wolverine: {
    id: 'wolverine',
    name: 'Wolverine',
    class: 'Mutant',
    boundChampions: [],
    verified: [],
    mcochubAnchor: 1738,
  },
};

export type Battlecast6Rating =
  | { rating: number; source: 'verified' }
  | { rating: number; source: 'mcochub-alpha' };

/**
 * Look up a 6★ battlecast's rating at (rank, sig).
 *
 *   - Returns `source: 'verified'` if a verified anchor matches exactly.
 *   - Returns `source: 'mcochub-alpha'` ONLY when the query is (R1, 0)
 *     AND the relic has a MCOCHUB anchor — MCOCHUB's state attribution
 *     is best-guess, we don't extrapolate from it.
 *   - Returns null otherwise. Callers display "—" or invite submissions.
 */
export function battlecast6Rating(
  id: Battlecast6Id,
  rank: RelicRank,
  sig: LevelBracket,
): Battlecast6Rating | null {
  const def = BATTLECAST_6STAR_CATALOG[id];
  if (!def) return null;

  for (const v of def.verified) {
    if (v.rank === rank && v.sig === sig) {
      return { rating: v.rating, source: 'verified' };
    }
  }

  if (rank === 'R1' && sig === 0 && def.mcochubAnchor !== null) {
    return { rating: def.mcochubAnchor, source: 'mcochub-alpha' };
  }

  return null;
}
