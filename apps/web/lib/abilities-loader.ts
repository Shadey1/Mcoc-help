import abilitiesData from '../../../data/champions/abilities.json' with { type: 'json' };
import auntmData from '../../../data/champions/immunities-auntm.json' with { type: 'json' };
import fandomData from '../../../data/champions/abilities-fandom.json' with { type: 'json' };

/**
 * Per-champion ability data scraped from MCOCHUB (see
 * scripts/refresh-abilities-from-mcochub.ts). The file is read at build
 * time only — Next.js static export bakes each champion's slice into the
 * detail page's static HTML, so clients never download the full 1.4 MB
 * payload.
 */
export type SynergyPill = {
  /** MCOCHUB slugs of the champions whose presence on the team grants this pill. */
  partners: string[];
  /** Condition / effect description from MCOCHUB's tooltip text. */
  note: string;
};

export type AbilityPill = {
  name: string;
  /** Present only on synergy-granted pills. */
  synergy?: SynergyPill;
};

export type KitCard = {
  title: string;
  /** "ALWAYS ACTIVE" / "PASSIVE" / "MEDIUM, HEAVY & SP1" etc. May be empty
   *  for cards whose summary had no " - " separator (Special Attacks). */
  trigger: string;
  lines: string[];
};

export type ChampionAbilities = {
  source: { slug: string; url: string };
  pills: {
    abilities: AbilityPill[];
    immunities: AbilityPill[];
    tags: string[];
  };
  kit: {
    signature: KitCard | null;
    cards: KitCard[];
  };
};

type AbilitiesFile = {
  version: string;
  source: string;
  lastImported: string;
  champions: Record<string, ChampionAbilities>;
};

const data = abilitiesData as AbilitiesFile;

/** Abilities for a champion by our seed id, or null when not yet imported. */
export function loadAbilitiesFor(seedId: string): ChampionAbilities | null {
  return data.champions[seedId] ?? null;
}

export function abilitiesMeta() {
  return {
    source: data.source,
    lastImported: data.lastImported,
    championCount: Object.keys(data.champions).length,
  };
}

/**
 * Synergy partner slugs come from MCOCHUB image filenames and use that
 * site's slug convention (lowercase-no-separators, occasionally with
 * exceptions like "Baron_Zemo" or "stormpyramidx"). We resolve them
 * back to our seed ids via the source.slug recorded for every imported
 * champion, normalising both sides so capitalisation and underscores
 * don't matter.
 */
function canonicaliseMcochubSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const partnerLookup: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [seedId, ch] of Object.entries(data.champions)) {
    m.set(canonicaliseMcochubSlug(ch.source.slug), seedId);
  }
  return m;
})();

/**
 * Resolve a MCOCHUB partner slug to our seed id, or null when the
 * partner is not in our imported set (typically non-released stubs or
 * legacy 6-star-only champs that never reached the 7★ pool).
 */
export function resolvePartnerSlug(mcochubSlug: string): string | null {
  return partnerLookup.get(canonicaliseMcochubSlug(mcochubSlug)) ?? null;
}

// ─── Auntm.ai passives ─────────────────────────────────────────────────
//
// The auntm.ai JS bundle carries prose lines like
// "Ant-Man is Immune to Poison and Shock effects." for legacy champions
// whose MCOCHUB detail page doesn't render a passive ability card. We
// extract these during the immunity-source pass (see
// scripts/extract-immunities-from-auntm.ts) and expose them here so the
// champion detail page can render a "PASSIVES · via auntm.ai" card next
// to the MCOCHUB kit. Empty for post-2024 champions (auntm freeze) and
// for champs whose passives are already covered by MCOCHUB cards.

type AuntmFile = {
  _meta: Record<string, unknown>;
  champions: Record<string, unknown>;
  passives: Record<string, string[]>;
};

const auntm = auntmData as unknown as AuntmFile;

export function loadAuntmPassivesFor(seedId: string): string[] {
  return auntm.passives[seedId] ?? [];
}

// ─── Fandom wiki kit fallback ──────────────────────────────────────────
//
// For champions whose MCOCHUB page has been overtaken by a Kabam buff
// (e.g. Spider-Man Symbiote's 2026 rework), the Fandom wiki tends to
// carry the fuller kit text before MCOCHUB's maintainers catch up.
// Populated by `pnpm refresh-abilities-fandom`; the champion detail
// page renders it as a supplementary "via Fandom wiki" panel — same
// treatment as [[loadAuntmPassivesFor]]. Data lives at
// data/champions/abilities-fandom.json, keyed by seed id.

export type FandomCard = {
  /** Sub-heading text as it appears on Fandom (e.g. "Critical Hits",
   *  "Special 1 - Web-Slinger", "Symbiotic Enhancement — Special
   *  Attacks"). Empty for leading unlabelled prose in a section. */
  title: string;
  lines: string[];
};

export type FandomSection = {
  /** "Abilities" / "Signature Ability" / "Special Attacks". */
  title: string;
  cards: FandomCard[];
};

export type FandomKit = {
  source: { pageTitle: string; url: string; capturedAt: string };
  sections: FandomSection[];
};

type FandomFile = {
  _meta: Record<string, unknown>;
  champions: Record<string, FandomKit>;
};

const fandom = fandomData as unknown as FandomFile;

export function loadFandomKitFor(seedId: string): FandomKit | null {
  return fandom.champions[seedId] ?? null;
}
