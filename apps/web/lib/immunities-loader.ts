import fixtureJson from '../../../data/champions/immunities-fixture.json' with { type: 'json' };
import backfillJson from '../../../data/champions/immunities-backfill.json' with { type: 'json' };
import type {
  ChampionImmunities,
  ImmunityDataset,
} from '@prestige-tools/engine';

/**
 * Production loader for the four-signal immunity dataset.
 *
 * Two sources are merged, most-authoritative last:
 *   1. immunities-backfill.json — auto-derived from MCOCHUB pills. Covers
 *      the immune + synergy bands for whichever champions MCOCHUB tagged
 *      with a matching per-effect pill (typically ~120). Cheap and
 *      refreshable; regenerate via `pnpm backfill-immunities`.
 *   2. immunities-fixture.json — hand-curated four-signal marks for
 *      champions we've explicitly transcribed from the GuiaMTC chart.
 *      Wins per-champion (replacing, not merging effect-by-effect) so
 *      the richer data isn't diluted by MCOCHUB's coarser tags.
 *
 * The fixture is authoritative because MCOCHUB doesn't distinguish true
 * immune from ≥100%-resist (Onslaught's "150% resist" reads as no pill
 * at all in MCOCHUB, since resistance isn't classed as immunity there).
 * Treating fixture as per-champion override keeps that curated shape.
 */

type BackfillFile = {
  _meta: { note: string; source: string; generatedAt: string; championCount: number };
  champions: Record<string, ChampionImmunities>;
};

type FixtureFile = {
  _meta: { note: string; source: string; capturedAt: string };
  champions: Record<string, ChampionImmunities>;
};

const backfill = backfillJson as unknown as BackfillFile;
const fixture = fixtureJson as unknown as FixtureFile;

let mergedCache: ImmunityDataset | null = null;

function computeMerged(): ImmunityDataset {
  const merged: ImmunityDataset = { ...backfill.champions };
  // Fixture replaces per-champion so the four-signal richness isn't
  // overwritten by MCOCHUB's coarser immune-or-synergy flags.
  for (const [id, data] of Object.entries(fixture.champions)) {
    merged[id] = data;
  }
  return merged;
}

export function loadImmunityDataset(): ImmunityDataset {
  if (mergedCache === null) mergedCache = computeMerged();
  return mergedCache;
}

export function immunitiesMeta(): {
  source: string;
  capturedAt: string;
  championCount: number;
  fixtureChampions: number;
  backfillChampions: number;
} {
  const merged = loadImmunityDataset();
  return {
    source: `MCOCHUB backfill + hand-curated fixture`,
    capturedAt: backfill._meta.generatedAt,
    championCount: Object.keys(merged).length,
    fixtureChampions: Object.keys(fixture.champions).length,
    backfillChampions: Object.keys(backfill.champions).length,
  };
}
