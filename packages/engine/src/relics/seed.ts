// Relic prestige seed data
//
// All values verified from in-game screenshots (mu3rto's roster, May 2026).
// Sparse on purpose: only known anchors are present. The engine interpolates
// linearly between nearest known points for missing levels (see prestige.ts).
//
// As more data points come in (every time a relic is at a new level), drop
// the value here and update _meta.lastVerified.

import type { Rank, Level, SpecialRelicId } from './types';

export type PrestigeTable = Record<Rank, Partial<Record<Level, number>>>;

/**
 * Standard 7★ statcast prestige.
 *
 * Confirmed: class/adjective/effect do not affect this curve. 12 different
 * relics at R1 L0 (Sturdy Tech, Shielded Science, Shielded Mystic, Shielded
 * Cosmic, Precise Skill, Piercing Cosmic, Insulated Science, Insulated Mystic,
 * Impactful Science, Expert Mutant, plus two others) all read 1,856 BHR.
 *
 * R3-R6 not yet reachable in-game; left empty for forward compatibility.
 */
export const STANDARD_7STAR_STATCAST: PrestigeTable = {
  1: {
    0: 1856,
    60: 2310,
    200: 2946,
  },
  2: {
    20: 2583,
    40: 2674,
    60: 2764,
    80: 2855,
    100: 2946,
    200: 3400,
  },
  3: {},
  4: {},
  5: {},
  6: {},
};

/**
 * Special relics that don't follow the standard curve.
 *
 * Cosmic Egg: bound to Venom The Duck. Known anchors are R2 L200 = 4084
 * (from TOP RELICS panel) and R5 L0 = 3060 (post rank-up screenshot).
 * The wide gap means R3 and R4 are completely unknown — interpolation
 * between R2 and R5 anchors crosses ranks and isn't reliable. Engine
 * will return null for R3/R4 lookups; UI should label "data not yet known."
 */
export type SpecialDef = {
  name: string;
  championBound: string | null;
  class: 'Cosmic' | 'Mutant' | 'Mystic' | 'Science' | 'Skill' | 'Tech';
  prestige: PrestigeTable;
};

export const SPECIALS: Record<SpecialRelicId, SpecialDef> = {
  'cosmic-egg': {
    name: 'The Cosmic Egg',
    championBound: 'venom-the-duck',
    class: 'Cosmic',
    prestige: {
      1: {},
      2: { 200: 4084 },
      3: {},
      4: {},
      // R5 L0 = 3060 was previously attributed here; user clarified that
      // value was actually a 6★ R5 sig 200 reading. It now lives in
      // BATTLECAST_6STAR_CATALOG.'cosmic-egg' as a verified anchor.
      5: {},
      6: {},
    },
  },
};
