/**
 * Backfill the four-signal immunity dataset from MCOCHUB data we already
 * have in data/champions/abilities.json.
 *
 * MCOCHUB's pills.immunities cover two of the four bands cleanly:
 *   immune  — innate pill (no synergy field)
 *   synergy — pill with a synergy.partners list
 *
 * The other two bands (resist %, mechanic Purify/Duration) are NOT in
 * MCOCHUB — they only appear in the GuiaMTC chart, which is images and
 * needs manual transcription. This script does what it can automatically;
 * the fixture (data/champions/immunities-fixture.json) still overrides
 * per-champion for anyone we've hand-curated with the richer bands.
 *
 * Output shape at data/champions/immunities-backfill.json mirrors the
 * fixture — same JSON shape, different provenance. The web loader
 * merges backfill + fixture, fixture wins per-champion.
 *
 * Rerun after abilities.json is refreshed:
 *   pnpm backfill-immunities
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ABILITIES_PATH = 'data/champions/abilities.json';
const SEED_PATH = 'data/champions/seed.json';
const OUTPUT_PATH = 'data/champions/immunities-backfill.json';

/** The 13 offence-relevant effects the /immunities view tracks. Keep in
 *  lockstep with IMMUNITY_EFFECTS in packages/engine/src/immunities.ts. */
const TRACKED_EFFECTS = new Set([
  'Bleed',
  'Poison',
  'Incinerate',
  'Coldsnap',
  'Shock',
  'Neuroshock',
  'Stun',
  'Stagger',
  'Nullify',
  'Armor Break',
  'Degeneration',
  'Power Burn',
  'Heal Block',
]);

type ImmunityBand =
  | { band: 'immune' }
  | { band: 'synergy'; partner: string };

type ChampionImmunities = Record<string, ImmunityBand>;

type AbilitiesFile = {
  champions: Record<
    string,
    {
      pills: {
        immunities: Array<{
          name: string;
          synergy?: { partners: string[]; note?: string };
        }>;
      };
    }
  >;
};

type SeedFile = {
  champions: Array<{ id: string; name: string }>;
};

/**
 * MCOCHUB immunity pills are named "X Immunity". Strip the suffix and
 * verify against our tracked-effect vocabulary. Returns null when the
 * pill doesn't map to a tracked effect (e.g. "Reverse Control
 * Immunity" or the typo "Concussion Immunnity").
 */
function pillToEffect(pillName: string): string | null {
  const stripped = pillName.replace(/\s+Immunity$/i, '').trim();
  return TRACKED_EFFECTS.has(stripped) ? stripped : null;
}

/**
 * Resolve MCOCHUB partner slugs into human-readable names via the seed
 * champion lookup. Falls back to a prettified slug for partners not in
 * seed (rare — usually old 6★-only champs). Multiple partners on one
 * pill are joined with " · " to signal "any of these on the team".
 */
function formatPartners(
  partnerSlugs: string[],
  mcochubSlugToSeedName: Map<string, string>,
): string {
  const names = partnerSlugs.map((s) => {
    const norm = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      mcochubSlugToSeedName.get(norm) ??
      s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    );
  });
  return names.join(' · ');
}

// ─── Main ──────────────────────────────────────────────────────────────

function main() {
  const abilities = JSON.parse(
    readFileSync(ABILITIES_PATH, 'utf8'),
  ) as AbilitiesFile;
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as SeedFile;

  // Build seed name lookup keyed by canonicalised MCOCHUB slug. The
  // abilities importer already normalises against the same rule; we
  // reuse it here so "Baron_Zemo" and "baronzemo" both resolve.
  const seedNameLookup = new Map<string, string>();
  // For each champion in abilities.json we know their mcochub source slug
  // via the earlier importer. But we need the reverse map: slug → name.
  // Build it from seed.name and the champion id (seed champion ids
  // usually canonicalise to the same key).
  for (const c of seed.champions) {
    const key = c.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    seedNameLookup.set(key, c.name);
  }
  // Also add any explicit MCOCHUB slugs we've seen (abilities.json carries
  // source.slug per champ). This picks up all the divergent slugs like
  // "adam" → "Adam Warlock", "vision-1" → "Vision", "howardmech" etc.
  const abilitiesData = abilities as unknown as {
    champions: Record<
      string,
      { source: { slug: string }; pills: AbilitiesFile['champions'][string]['pills'] }
    >;
  };
  const seedById = new Map(seed.champions.map((c) => [c.id, c.name] as const));
  for (const [seedId, entry] of Object.entries(abilitiesData.champions)) {
    const name = seedById.get(seedId);
    if (!name) continue;
    const key = entry.source.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seedNameLookup.has(key)) seedNameLookup.set(key, name);
  }

  const out: Record<string, ChampionImmunities> = {};
  let backfilled = 0;
  let skippedPills = 0;

  for (const [seedId, entry] of Object.entries(abilities.champions)) {
    const perEffect: ChampionImmunities = {};
    for (const pill of entry.pills.immunities) {
      const effect = pillToEffect(pill.name);
      if (!effect) {
        skippedPills++;
        continue;
      }
      if (pill.synergy && pill.synergy.partners.length > 0) {
        perEffect[effect] = {
          band: 'synergy',
          partner: formatPartners(pill.synergy.partners, seedNameLookup),
        };
      } else {
        // MCOCHUB never distinguishes ≥100% resist from true immune, so
        // "immune" here is our best available signal until GuiaMTC lands.
        perEffect[effect] = { band: 'immune' };
      }
    }
    if (Object.keys(perEffect).length > 0) {
      out[seedId] = perEffect;
      backfilled++;
    }
  }

  const payload = {
    _meta: {
      note:
        'Auto-backfilled from data/champions/abilities.json (MCOCHUB pills.immunities). ' +
        'Covers only the immune + synergy bands — the resist % and mechanic Purify/Duration ' +
        'bands come from a separate GuiaMTC transcription pass (task #80) and override this ' +
        'file per-champion via the smoke fixture.',
      source: 'MCOCHUB pills.immunities (via abilities.json)',
      generatedAt: new Date().toISOString().slice(0, 10),
      championCount: backfilled,
      skippedPills,
    },
    champions: out,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Backfilled ${backfilled} champion immunity records → ${OUTPUT_PATH}`,
  );
  console.log(
    `Skipped ${skippedPills} pills (effect not in tracked vocabulary).`,
  );
}

main();
