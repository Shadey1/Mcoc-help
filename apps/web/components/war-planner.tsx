'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  assignWar,
  type Ascension,
  type Champion,
  type ChampionState,
  type Rank,
  type WarPlayer,
  type WarResult,
} from '@prestige-tools/engine';
import {
  decodeBgShare,
  encodeBgShare,
  loadWarConfig,
  saveWarConfig,
  type WarBgs,
  type WarConfig,
  type WarPlayerInput,
} from '../lib/war-storage';
import { fetchShare } from '../lib/share-client';
import { fetchSharedPool, type SharedPoolPayload } from '../lib/share-pool-client';
import { WarPoolTickbox } from './war-pool-tickbox';
import {
  WarShareInput,
  extractShareId,
  type WarShareRowStatus,
} from './war-share-input';
import { WarPlacementTable } from './war-placement-table';
import { WarPoolCoverage } from './war-pool-coverage';
import { SharePoolModal } from './share-pool-modal';

/**
 * Floor options expressed on the effective-rank ladder. The engine compares
 * `state.rank + ascensionLevel` (with R6 base = 7), so a single tier admits
 * multiple {rank, ascension} pairs — picking the lowest-rank representative
 * for each tier so the saved floor reads naturally.
 *
 *   tier 3 — R3 A0
 *   tier 4 — R4 A0 / R3 A1
 *   tier 5 — R4 A1 / R5 A0
 *   tier 6 — R4 A2 / R5 A1
 *   tier 7 — R5 A2 / R6 A0
 *   tier 8 — R6 A1
 *   tier 9 — R6 A2
 *
 * R6 tiers are included for forward-compat (no roster UI for R6 yet);
 * picking them today produces 0 placements.
 */
type FloorOption = {
  value: string;
  rank: Rank;
  ascension: Ascension;
  label: string;
};
const FLOOR_OPTIONS: ReadonlyArray<FloorOption> = [
  { value: 't3', rank: 3, ascension: 'A0', label: 'R3 minimum (any rank-3+)' },
  { value: 't4', rank: 4, ascension: 'A0', label: 'R4 minimum (default)' },
  { value: 't5', rank: 4, ascension: 'A1', label: 'R4 A1 / R5 A0 minimum' },
  { value: 't6', rank: 4, ascension: 'A2', label: 'R4 A2 / R5 A1 minimum' },
  { value: 't7', rank: 5, ascension: 'A2', label: 'R5 A2 / R6 A0 minimum' },
  { value: 't8', rank: 6, ascension: 'A1', label: 'R6 A1 minimum' },
  { value: 't9', rank: 6, ascension: 'A2', label: 'R6 A2 minimum (top of the ladder)' },
];

/** Resolve the current floor back to its dropdown value via effective rank. */
const RANK_BASE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 7 };
const ASC_LEVEL: Record<Ascension, number> = { A0: 0, A1: 1, A2: 2 };
function effectiveTier(rank: Rank, ascension: Ascension): number {
  return (RANK_BASE[rank] ?? rank) + ASC_LEVEL[ascension];
}
function floorOptionValue(floor: { rank: Rank; ascension: Ascension }): string {
  const tier = effectiveTier(floor.rank, floor.ascension);
  return FLOOR_OPTIONS.find(
    (o) => effectiveTier(o.rank, o.ascension) === tier,
  )?.value ?? 't4';
}

type BgIndex = 0 | 1 | 2;
const BG_INDICES: readonly BgIndex[] = [0, 1, 2] as const;
const BG_LABELS: Record<BgIndex, string> = { 0: 'BG1', 1: 'BG2', 2: 'BG3' };

type LoadedRoster = {
  label: string | null;
  champions: ChampionState[];
};

type BgRunState = {
  statuses: WarShareRowStatus[];
  rosters: Map<number, LoadedRoster>;
  result: WarResult | null;
  /**
   * Snapshots taken at the moment Generate placements was clicked. Used to
   * detect when the user has edited the pool or floor since the last run —
   * the placement table is still useful in that case, but worth flagging
   * as stale so they know to re-generate.
   */
  poolSnapshot: ReadonlySet<string> | null;
  floorSnapshot: { rank: number; ascension: string } | null;
};

const EMPTY_RUN: BgRunState = {
  statuses: [],
  rosters: new Map(),
  result: null,
  poolSnapshot: null,
  floorSnapshot: null,
};

export function WarPlanner({ champions }: { champions: Champion[] }) {
  const [config, setConfig] = useState<WarConfig | null>(null);
  const [activeBg, setActiveBg] = useState<BgIndex>(0);
  const [runs, setRuns] = useState<Record<BgIndex, BgRunState>>({
    0: EMPTY_RUN,
    1: EMPTY_RUN,
    2: EMPTY_RUN,
  });
  const [running, setRunning] = useState<BgIndex | null>(null);
  // Default collapsed if the pool has already been filled (returning user),
  // expanded if empty (first-time use).
  const [poolExpanded, setPoolExpanded] = useState<boolean | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [bgShareToast, setBgShareToast] = useState<string | null>(null);
  // Inbound shared-pool offer.
  const [inboundPool, setInboundPool] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; payload: SharedPoolPayload; id: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  // Inbound shared BG offer: decoded URL-embedded BG roster.
  const [inboundBg, setInboundBg] = useState<WarPlayerInput[] | null>(null);

  useEffect(() => {
    const loaded = loadWarConfig();
    setConfig(loaded);
    setPoolExpanded(loaded.pool.length === 0);
  }, []);

  // ?pool=<id> → fetch shared pool, banner offers import.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const poolId = params.get('pool');
    if (!poolId) return;
    setInboundPool({ kind: 'loading' });
    fetchSharedPool(poolId)
      .then((payload) => setInboundPool({ kind: 'ready', payload, id: poolId }))
      .catch((err: unknown) =>
        setInboundPool({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load',
        }),
      );
  }, []);

  // ?bg=<encoded> → decode and offer import into the active tab.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const bg = params.get('bg');
    if (!bg) return;
    const rows = decodeBgShare(bg);
    if (rows && rows.length > 0) setInboundBg(rows);
  }, []);

  const championLookup = useMemo(
    () => new Map(champions.map((c) => [c.id, c])),
    [champions],
  );

  if (!config || poolExpanded === null) {
    return <div className="text-sm text-[var(--color-ink-soft)] italic">Loading…</div>;
  }

  /**
   * Update the saved config WITHOUT wiping cached rosters/placement results.
   * Used for pool + floor edits — those don't invalidate the fetched roster
   * data, so the placement table can stay visible (marked stale via the
   * snapshot comparison) while the user continues to tweak.
   */
  function updateConfig(next: WarConfig) {
    setConfig(next);
    saveWarConfig(next);
  }

  /**
   * Wipe cached rosters/results across all three BGs. Called whenever the
   * BG paste rows change — those URLs need to be re-fetched.
   */
  function clearAllRuns() {
    setRuns({ 0: EMPTY_RUN, 1: EMPTY_RUN, 2: EMPTY_RUN });
  }

  function updateBg(bg: BgIndex, rows: WarPlayerInput[]) {
    if (!config) return;
    const nextBgs: WarBgs = [...config.bgs] as WarBgs;
    nextBgs[bg] = rows;
    updateConfig({ ...config, bgs: nextBgs });
    clearAllRuns();
  }

  async function processBg(bg: BgIndex) {
    if (!config) return;
    const rows = config.bgs[bg];
    setRunning(bg);
    setRuns((prev) => ({ ...prev, [bg]: { ...prev[bg], result: null } }));

    const newStatuses: WarShareRowStatus[] = rows.map((row) =>
      row.url.trim() ? { state: 'loading' } : { state: 'empty' },
    );
    setRuns((prev) => ({
      ...prev,
      [bg]: { ...prev[bg], statuses: newStatuses },
    }));

    const newRosters = new Map<number, LoadedRoster>();
    const players: WarPlayer[] = [];

    await Promise.all(
      rows.map(async (row, idx) => {
        const trimmedUrl = row.url.trim();
        if (!trimmedUrl) {
          newStatuses[idx] = { state: 'empty' };
          return;
        }
        const id = extractShareId(trimmedUrl);
        if (!id) {
          newStatuses[idx] = { state: 'error', message: 'Invalid share URL' };
          return;
        }
        try {
          const payload = await fetchShare(id);
          newRosters.set(idx, {
            label: payload.label,
            champions: payload.champions,
          });
          newStatuses[idx] = {
            state: 'loaded',
            label: payload.label,
            champCount: payload.champions.length,
            lastSyncedAt: payload.lastSyncedAt,
          };
          players.push({
            id: `bg${bg}-slot-${idx}`,
            name: row.name.trim() || payload.label || `Player ${idx + 1}`,
            roster: payload.champions,
          });
        } catch (err) {
          newStatuses[idx] = {
            state: 'error',
            message: err instanceof Error ? err.message : 'Load failed',
          };
        }
      }),
    );

    const poolSnapshot: ReadonlySet<string> = new Set(config.pool);
    const floorSnapshot = {
      rank: config.floor.rank,
      ascension: config.floor.ascension,
    };

    if (players.length === 0) {
      setRuns((prev) => ({
        ...prev,
        [bg]: {
          statuses: newStatuses,
          rosters: newRosters,
          result: null,
          poolSnapshot,
          floorSnapshot,
        },
      }));
      setRunning(null);
      return;
    }

    const r = assignWar({
      defenderPool: poolSnapshot,
      floor: config.floor,
      players,
      slotsPerPlayer: 5,
    });
    setRuns((prev) => ({
      ...prev,
      [bg]: {
        statuses: newStatuses,
        rosters: newRosters,
        result: r,
        poolSnapshot,
        floorSnapshot,
      },
    }));
    setRunning(null);
  }

  function copyFromBg(source: BgIndex, target: BgIndex) {
    if (!config || source === target) return;
    const sourceRows = config.bgs[source];
    if (sourceRows.length === 0) return;
    const cloned: WarPlayerInput[] = sourceRows.map((r) => ({ ...r }));
    updateBg(target, cloned);
  }

  async function shareBg(bg: BgIndex) {
    if (!config) return;
    const rows = config.bgs[bg].filter((r) => r.url.trim().length > 0);
    if (rows.length === 0) {
      setBgShareToast('Add at least one share URL before sharing this BG.');
      setTimeout(() => setBgShareToast(null), 3500);
      return;
    }
    const encoded = encodeBgShare(rows);
    const url = `${window.location.origin}/war/?bg=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setBgShareToast(`${BG_LABELS[bg]} share link copied (${rows.length} players)`);
    } catch {
      setBgShareToast(url);
    }
    setTimeout(() => setBgShareToast(null), 4500);
  }

  // Cross-BG dup detection: any URLs that appear in more than one BG?
  const dupUrls = findDuplicateUrls(config.bgs);

  const poolSet = new Set(config.pool);
  const activeRun = runs[activeBg];
  const activeBgRows = config.bgs[activeBg];
  const hasActiveUrls = activeBgRows.some((p) => p.url.trim().length > 0);
  const canProcessActive = hasActiveUrls && poolSet.size > 0 && running === null;

  return (
    <div className="space-y-10">
      {inboundPool && (
        <InboundPoolBanner
          state={inboundPool}
          onImport={(payload) => {
            // Bundled BGs (shares created after the BG-bundling change)
            // come through as `bgs` — pad to length 3 and clip per-BG to
            // the local cap so a stale schema can't blow past UI limits.
            const incomingBgs = payload.bgs;
            const nextBgs: WarBgs = incomingBgs
              ? [
                  (incomingBgs[0] ?? []).slice(0, 10),
                  (incomingBgs[1] ?? []).slice(0, 10),
                  (incomingBgs[2] ?? []).slice(0, 10),
                ]
              : config.bgs;
            updateConfig({
              ...config,
              pool: [...payload.pool].sort(),
              floor: payload.floor,
              bgs: nextBgs,
            });
            // Inbound import can replace BG rows entirely — wipe cached
            // rosters so the new ones get re-fetched.
            if (incomingBgs) clearAllRuns();
            setInboundPool(null);
            setPoolExpanded(false);
          }}
          onDismiss={() => setInboundPool(null)}
        />
      )}

      {inboundBg && (
        <InboundBgBanner
          rows={inboundBg}
          targetLabel={BG_LABELS[activeBg]}
          onImport={() => {
            updateBg(activeBg, inboundBg);
            setInboundBg(null);
          }}
          onDismiss={() => setInboundBg(null)}
        />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="editorial-heading text-2xl mb-1">
              1. Pick your defender pool
            </h2>
            <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
              Tick every champion your alliance considers war-worthy on
              defence. Minimum 50 (the war size); 60+ suggested to give
              headroom over roster gaps. Shared across all three BGs.
              Saved locally; collapses to a single line once filled.
            </p>
          </div>
          {poolSet.size > 0 && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors whitespace-nowrap"
              title="Generate a link the alliance can use to load this pool"
            >
              Share pool →
            </button>
          )}
        </div>
        <WarPoolTickbox
          champions={champions}
          selected={poolSet}
          onChange={(next) =>
            updateConfig({ ...config, pool: [...next].sort() })
          }
          expanded={poolExpanded}
          onToggleExpanded={() => setPoolExpanded((v) => !v)}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="editorial-heading text-2xl mb-1">2. Minimum rank</h2>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
            Champions below this effective tier won&apos;t count as
            placeable. The ladder ties each ascension to a rank step:
            R4 A1 ≡ R5 A0, R4 A2 ≡ R5 A1, R5 A2 ≡ R6 A0. R4 minimum
            is the default for most rosters.
          </p>
        </div>
        <select
          value={floorOptionValue(config.floor)}
          onChange={(e) => {
            const opt = FLOOR_OPTIONS.find((o) => o.value === e.target.value);
            if (!opt) return;
            updateConfig({
              ...config,
              floor: { rank: opt.rank, ascension: opt.ascension },
            });
          }}
          className="px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] min-w-[22rem]"
        >
          {FLOOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="editorial-heading text-2xl mb-1">
            3. Paste alliance share links
          </h2>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
            One row per alliance member, ten per BG. The same player should
            sit in exactly one BG — duplicate URLs are flagged below. Switch
            between BG1/2/3 to edit each group&apos;s roster, copy from
            another BG when the line-up is similar, or share a single BG&apos;s
            roster as its own link.
          </p>
        </div>

        <BgTabs
          active={activeBg}
          onSelect={setActiveBg}
          counts={config.bgs.map((rows) =>
            rows.filter((r) => r.url.trim().length > 0).length,
          ) as [number, number, number]}
        />

        <div className="flex flex-wrap gap-2 items-center">
          <CopyFromBgMenu
            activeBg={activeBg}
            bgs={config.bgs}
            onCopy={(source) => copyFromBg(source, activeBg)}
          />
          <button
            type="button"
            onClick={() => void shareBg(activeBg)}
            className="text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
            title={`Copy a share link for ${BG_LABELS[activeBg]} only`}
          >
            Share {BG_LABELS[activeBg]} →
          </button>
          {bgShareToast && (
            <span className="text-xs text-[var(--color-marvel-editorial)] italic">
              {bgShareToast}
            </span>
          )}
        </div>

        <WarShareInput
          rows={activeBgRows}
          statuses={activeRun.statuses}
          onChange={(rows) => updateBg(activeBg, rows)}
        />

        {dupUrls.size > 0 && (
          <p className="text-xs text-[var(--color-marvel-impact)]">
            ⚠ {dupUrls.size} share URL{dupUrls.size === 1 ? '' : 's'} appear in
            more than one BG. A player can only sit in one BG per war.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={() => void processBg(activeBg)}
            disabled={!canProcessActive}
            className="px-6 py-3 bg-[var(--color-marvel-impact)] text-white font-medium rounded shadow-lg disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed disabled:shadow-none transition-colors"
          >
            {running === activeBg
              ? `Loading & placing ${BG_LABELS[activeBg]}…`
              : `Generate placements for ${BG_LABELS[activeBg]}`}
          </button>
          {!hasActiveUrls && (
            <p className="text-xs text-[var(--color-ink-soft)]">
              Paste at least one share URL above.
            </p>
          )}
          {hasActiveUrls && poolSet.size === 0 && (
            <p className="text-xs text-[var(--color-marvel-impact)]">
              Tick at least one champion in your defender pool.
            </p>
          )}
        </div>

        {activeRun.result && (
          <>
            {isRunStale(activeRun, config) && (
              <div className="border border-[var(--color-marvel-editorial)] bg-[var(--color-paper-soft)] rounded p-3 text-sm flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  ⚠ Pool or floor changed since this run — placements below
                  are stale. Add more from the suggestions, then regenerate.
                </span>
                <button
                  type="button"
                  onClick={() => void processBg(activeBg)}
                  disabled={!canProcessActive}
                  className="text-xs px-3 py-1.5 bg-[var(--color-marvel-impact)] text-white rounded hover:bg-[var(--color-marvel-editorial)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Re-generate {BG_LABELS[activeBg]}
                </button>
              </div>
            )}
            <WarPlacementTable
              result={activeRun.result}
              championLookup={championLookup}
              slotsPerPlayer={5}
            />
          </>
        )}

        {activeRun.result && activeRun.rosters.size > 0 && (
          <WarPoolCoverage
            champions={champions}
            pool={poolSet}
            floor={config.floor}
            rosters={[...activeRun.rosters.values()]}
            onAddToPool={(championId) => {
              if (poolSet.has(championId)) return;
              updateConfig({
                ...config,
                pool: [...config.pool, championId].sort(),
              });
            }}
          />
        )}
      </section>

      <SharePoolModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        pool={config.pool}
        floor={config.floor}
        bgs={config.bgs}
      />
    </div>
  );
}

/**
 * True if the current config's pool or floor differs from what was snapshotted
 * when the run completed. The placement table is still rendered (the user's
 * mid-flight tweaks shouldn't yank the data out from under them) but a
 * banner above the table flags the staleness so they regenerate when ready.
 */
function isRunStale(run: BgRunState, config: WarConfig): boolean {
  if (!run.poolSnapshot || !run.floorSnapshot) return false;
  if (
    run.floorSnapshot.rank !== config.floor.rank ||
    run.floorSnapshot.ascension !== config.floor.ascension
  ) {
    return true;
  }
  if (run.poolSnapshot.size !== config.pool.length) return true;
  for (const id of config.pool) {
    if (!run.poolSnapshot.has(id)) return true;
  }
  return false;
}

function findDuplicateUrls(bgs: WarBgs): Set<string> {
  const seen = new Map<string, number>();
  for (const rows of bgs) {
    for (const row of rows) {
      const id = extractShareId(row.url);
      if (!id) continue;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

function BgTabs({
  active,
  onSelect,
  counts,
}: {
  active: BgIndex;
  onSelect: (bg: BgIndex) => void;
  counts: [number, number, number];
}) {
  return (
    <div
      role="tablist"
      aria-label="Battlegroup"
      className="inline-flex gap-1 bg-[var(--color-paper-soft)] rounded-md p-1 border border-[var(--color-rule)] text-sm"
    >
      {BG_INDICES.map((bg) => (
        <button
          key={bg}
          type="button"
          role="tab"
          aria-selected={active === bg}
          onClick={() => onSelect(bg)}
          className={`px-3 py-1 rounded transition-colors ${
            active === bg
              ? 'bg-[var(--color-paper)] font-medium'
              : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
          }`}
        >
          {BG_LABELS[bg]}
          {counts[bg] > 0 && (
            <span className="ml-1.5 text-xs text-[var(--color-ink-soft)] numeric">
              ({counts[bg]})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function CopyFromBgMenu({
  activeBg,
  bgs,
  onCopy,
}: {
  activeBg: BgIndex;
  bgs: WarBgs;
  onCopy: (source: BgIndex) => void;
}) {
  const sources = BG_INDICES.filter(
    (bg) =>
      bg !== activeBg && bgs[bg].some((r) => r.url.trim().length > 0),
  );
  if (sources.length === 0) {
    return (
      <span className="text-xs text-[var(--color-ink-soft)] italic">
        Copy from BG → fill another BG first to enable
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-[var(--color-ink-soft)]">Copy from</span>
      {sources.map((bg) => (
        <button
          key={bg}
          type="button"
          onClick={() => onCopy(bg)}
          className="px-2 py-1 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
          title={`Overwrite ${BG_LABELS[activeBg]} with ${BG_LABELS[bg]}'s share URLs`}
        >
          {BG_LABELS[bg]}
        </button>
      ))}
    </div>
  );
}

function InboundPoolBanner({
  state,
  onImport,
  onDismiss,
}: {
  state:
    | { kind: 'loading' }
    | { kind: 'ready'; payload: SharedPoolPayload; id: string }
    | { kind: 'error'; message: string };
  onImport: (payload: SharedPoolPayload) => void;
  onDismiss: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-4 text-sm text-[var(--color-ink-soft)] italic">
        Loading shared pool…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="border border-[var(--color-marvel-impact)] rounded-lg bg-[var(--color-paper-card)] p-4 text-sm flex items-baseline justify-between gap-3">
        <span className="text-[var(--color-marvel-impact)]">
          Couldn&apos;t load shared pool: {state.message}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs underline text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          Dismiss
        </button>
      </div>
    );
  }
  const { payload } = state;
  const bgPlayerCounts = (payload.bgs ?? []).map((g) =>
    g.filter((r) => r.url.trim().length > 0).length,
  );
  const totalBgPlayers = bgPlayerCounts.reduce((a, b) => a + b, 0);
  return (
    <div className="border-2 border-[var(--color-marvel-impact)] rounded-lg bg-[var(--color-paper-card)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <strong>Shared defender pool</strong>{' '}
          {payload.label && (
            <span className="text-[var(--color-ink-soft)]">
              · &ldquo;{payload.label}&rdquo;
            </span>
          )}
          <span className="text-[var(--color-ink-soft)]">
            {' '}— {payload.pool.length} champions, floor R{payload.floor.rank}
            {totalBgPlayers > 0 && (
              <> · {totalBgPlayers} BG roster URL{totalBgPlayers === 1 ? '' : 's'} bundled</>
            )}
          </span>
        </div>
        <span className="text-xs text-[var(--color-ink-soft)]">
          imports replace your current pool + floor
          {totalBgPlayers > 0 && ' + BG rosters'}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onImport(payload)}
          className="px-4 py-1.5 bg-[var(--color-marvel-impact)] text-white text-sm font-medium rounded hover:bg-[var(--color-marvel-editorial)]"
        >
          Import
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
        >
          Keep my current pool
        </button>
      </div>
    </div>
  );
}

function InboundBgBanner({
  rows,
  targetLabel,
  onImport,
  onDismiss,
}: {
  rows: WarPlayerInput[];
  targetLabel: string;
  onImport: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border-2 border-[var(--color-marvel-editorial)] rounded-lg bg-[var(--color-paper-card)] p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <strong>Shared BG roster</strong>
          <span className="text-[var(--color-ink-soft)]">
            {' '}— {rows.length} player share URL{rows.length === 1 ? '' : 's'}
          </span>
        </div>
        <span className="text-xs text-[var(--color-ink-soft)]">
          imports into the current tab ({targetLabel})
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onImport}
          className="px-4 py-1.5 bg-[var(--color-marvel-editorial)] text-white text-sm font-medium rounded hover:bg-[var(--color-marvel-impact)]"
        >
          Import into {targetLabel}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
