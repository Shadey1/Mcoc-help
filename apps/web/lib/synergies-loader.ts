import synergiesData from '../../../data/champions/synergies.json' with { type: 'json' };

/**
 * One champion's contribution to a single synergy.
 * Partners are the other champions required to activate it (the host
 * champion themselves isn't in the partners list — it's implied).
 */
export type PartnerRef = {
  /** Display name from mcoc.gg, always present. */
  name: string;
  /** Our seed slug, set only when the partner is in our seed (→ clickable). */
  slug?: string;
};

export type Synergy = {
  synergyId: number;
  name: string;
  icon: string;
  unique: boolean;
  partners: PartnerRef[];
  effects: string[];
};

type SynergiesFile = {
  _meta: {
    source: string;
    fetchedAt: string;
    seedChampionCount: number;
    mcocggChampionCount: number;
    matched: number;
    unmatched: string[];
  };
  champions: Record<string, Synergy[]>;
};

const data = synergiesData as SynergiesFile;

/** Synergies for the given champion slug, or [] if none / champion unknown. */
export function loadSynergiesForChampion(slug: string): Synergy[] {
  return data.champions[slug] ?? [];
}

export function synergiesMeta() {
  return data._meta;
}
