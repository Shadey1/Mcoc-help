import abilitiesData from '../../../data/champions/abilities.json' with { type: 'json' };

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
