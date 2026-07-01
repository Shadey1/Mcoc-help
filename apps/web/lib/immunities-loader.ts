import fixtureJson from '../../../data/champions/immunities-fixture.json' with { type: 'json' };
import backfillJson from '../../../data/champions/immunities-backfill.json' with { type: 'json' };
import kitJson from '../../../data/champions/immunities-kit-derived.json' with { type: 'json' };
import locksJson from '../../../data/immunities/_locks.json' with { type: 'json' };
import type {
  ChampionImmunities,
  ImmunityBand,
  ImmunityDataset,
} from '@prestige-tools/engine';

/**
 * Production loader for the four-signal immunity dataset.
 *
 * Three sources are merged, weakest → strongest, per effect:
 *
 *   1. immunities-backfill.json — MCOCHUB per-effect pills. Immune +
 *      synergy bands. Cheap, refreshed via `pnpm backfill-immunities`.
 *   2. immunities-kit-derived.json — parsed from champion ability
 *      text. Immune + resist %. Fills in the numeric resistances
 *      MCOCHUB pills can't express. Refreshed via
 *      `pnpm parse-immunity-kits`.
 *   3. immunities-fixture.json — hand-curated ground truth. All four
 *      bands. Superseded piece by piece as the GuiaMTC transcription
 *      pass (task #80) lands more data.
 *
 * Merge policy is per (champion, effect): higher-precedence source
 * wins. If a champion has a fixture entry for Bleed but not Poison,
 * their Poison still gets filled in from kit-derived or backfill.
 * When two sources both name the same effect the stronger source
 * wins even if its band would rank lower — the fixture is trusted
 * as the human intent.
 */

type SourceFile = {
  _meta: Record<string, unknown>;
  champions: Record<string, ChampionImmunities>;
};

const backfill = backfillJson as unknown as SourceFile;
const kit = kitJson as unknown as SourceFile;
const fixture = fixtureJson as unknown as SourceFile;

function mergePerEffect(
  base: ChampionImmunities | undefined,
  overlay: ChampionImmunities | undefined,
): ChampionImmunities | undefined {
  if (!base) return overlay;
  if (!overlay) return base;
  const out: Record<string, ImmunityBand> = { ...base };
  for (const [eff, band] of Object.entries(overlay)) {
    out[eff] = band;
  }
  return out;
}

let mergedCache: ImmunityDataset | null = null;

function computeMerged(): ImmunityDataset {
  const merged: ImmunityDataset = {};
  const allIds = new Set<string>([
    ...Object.keys(backfill.champions),
    ...Object.keys(kit.champions),
    ...Object.keys(fixture.champions),
  ]);
  for (const id of allIds) {
    let entry: ChampionImmunities | undefined = backfill.champions[id];
    entry = mergePerEffect(entry, kit.champions[id]);
    entry = mergePerEffect(entry, fixture.champions[id]);
    if (entry && Object.keys(entry).length > 0) merged[id] = entry;
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
  kitChampions: number;
  reconciliation: LocksMeta;
} {
  const merged = loadImmunityDataset();
  return {
    source: 'MCOCHUB pills + kit-parsed + hand-curated fixture',
    capturedAt:
      (backfill._meta as { generatedAt?: string }).generatedAt ?? '',
    championCount: Object.keys(merged).length,
    fixtureChampions: Object.keys(fixture.champions).length,
    backfillChampions: Object.keys(backfill.champions).length,
    kitChampions: Object.keys(kit.champions).length,
    reconciliation: locksMeta(),
  };
}

// ─── Reconciliation locks ──────────────────────────────────────────────

/**
 * Structure produced by scripts/reconcile-immunities.ts and consumed by
 * the /immunities view to signal which values have crossed the
 * consensus bar (locked) vs the provisional single-source shape the
 * loader emits above.
 */
type LocksMeta = {
  generated: string;
  chartDated: string;
  cellsTotal: number;
  cellsLocked: number;
  cellsInReviewQueue: number;
  conflicts: number;
  singleSource: number;
  staleOnly: number;
  uniqueChampsLocked: number;
  uniqueChampsProvisional: number;
};

type LocksFile = {
  generated: string;
  chartDated: string;
  _meta: LocksMeta;
  champions: Record<
    string,
    Record<
      string,
      {
        band: string;
        value?: number;
        qual?: string;
        partner?: string;
        confidence: string;
        _review?: true;
      }
    >
  >;
};

const locks = locksJson as unknown as LocksFile;

export function locksMeta(): LocksMeta {
  return {
    ...locks._meta,
    generated: locks.generated,
    chartDated: locks.chartDated,
  };
}

/**
 * True when the reconciliation pipeline has locked this specific
 * (champion, effect) cell at lock-2src or better. The view uses this
 * to badge verified entries so the player can tell curated data from
 * single-source auto-derived data.
 */
export function isCellLocked(championId: string, effect: string): boolean {
  return locks.champions[championId]?.[effect] !== undefined;
}
