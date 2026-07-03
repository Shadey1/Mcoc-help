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

// ─── Reciprocal (enabler-side) synergies ────────────────────────────────

/**
 * mcoc.gg publishes each synergy under its "host" champion — the one
 * whose page shows the effect prose. Partners on the same synergy don't
 * necessarily see it on their own page, so a user looking at (say)
 * Venom has no way to know that bringing Venom is what unlocks Knull's
 * Vessels of the Darkness benefit.
 *
 * We fix this by building a reverse index at module load: for every
 * synergy, add a lightweight reference under each of its partners so
 * their detail page can render an "Enables for other champions" panel
 * pointing back to the host and the specific effect.
 */
export type ReciprocalSynergy = {
  /** Slug of the champion whose page hosts the synergy prose. */
  hostSlug: string;
  synergy: Synergy;
};

const reciprocalIndex: Map<string, ReciprocalSynergy[]> = (() => {
  const idx = new Map<string, ReciprocalSynergy[]>();
  for (const [hostSlug, synergies] of Object.entries(data.champions)) {
    for (const synergy of synergies) {
      for (const partner of synergy.partners) {
        if (!partner.slug || partner.slug === hostSlug) continue;
        const arr = idx.get(partner.slug) ?? [];
        // Guard against double-counting the same (host, synergyId) pair
        // — mcoc.gg occasionally lists a partner twice on multi-variant
        // synergies.
        if (
          !arr.some(
            (r) => r.hostSlug === hostSlug && r.synergy.synergyId === synergy.synergyId,
          )
        ) {
          arr.push({ hostSlug, synergy });
        }
        idx.set(partner.slug, arr);
      }
    }
  }
  return idx;
})();

/**
 * Synergies the given champion ENABLES for a partner (i.e. where they
 * appear as a partner, not the host). Useful for the "who to bring"
 * decision: on champion X's page, users see which other champs benefit
 * from having X on the squad.
 */
export function loadReciprocalSynergiesForChampion(
  slug: string,
): ReciprocalSynergy[] {
  return reciprocalIndex.get(slug) ?? [];
}
