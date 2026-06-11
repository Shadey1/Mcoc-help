'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  assignWar,
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
import { SharePoolModal } from './share-pool-modal';

/**
 * Floor options — rank only. The engine ranks states by effective power
 * (rank + ascension), so "R4 minimum" lets a R3 A2 through too (same
 * effective tier as R4 A1). Ascension is dropped from the floor UI; we
 * always pass A0 so the floor sits at the bottom of its tier.
 */
const FLOOR_OPTIONS: ReadonlyArray<{
  value: string;
  rank: Rank;
  label: string;
}> = [
  { value: '3', rank: 3, label: 'R3 minimum (any rank-3+)' },
  { value: '4', rank: 4, label: 'R4 minimum (default)' },
  { value: '5', rank: 5, label: 'R5 minimum (top alliances only)' },
];

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
};

const EMPTY_RUN: BgRunState = {
  statuses: [],
  rosters: new Map(),
  result: null,
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

  function updateConfig(next: WarConfig) {
    setConfig(next);
    saveWarConfig(next);
    // Editing any row invalidates that BG's loaded state — wipe all results
    // so a stale table can't sit next to fresh URLs.
    setRuns({ 0: EMPTY_RUN, 1: EMPTY_RUN, 2: EMPTY_RUN });
  }

  function updateBg(bg: BgIndex, rows: WarPlayerInput[]) {
    if (!config) return;
    const nextBgs: WarBgs = [...config.bgs] as WarBgs;
    nextBgs[bg] = rows;
    updateConfig({ ...config, bgs: nextBgs });
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

    if (players.length === 0) {
      setRuns((prev) => ({
        ...prev,
        [bg]: { statuses: newStatuses, rosters: newRosters, result: null },
      }));
      setRunning(null);
      return;
    }

    const r = assignWar({
      defenderPool: new Set(config.pool),
      floor: config.floor,
      players,
      slotsPerPlayer: 5,
    });
    setRuns((prev) => ({
      ...prev,
      [bg]: { statuses: newStatuses, rosters: newRosters, result: r },
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
            updateConfig({
              ...config,
              pool: [...payload.pool].sort(),
              floor: payload.floor,
            });
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
            Champions below this effective rank won&apos;t count as placeable.
            R4 is a sensible default for most rosters; the engine now
            compares by effective power (R5 A0 = R4 A1 etc.) so the floor
            is permissive within its tier.
          </p>
        </div>
        <select
          value={String(config.floor.rank)}
          onChange={(e) => {
            const opt = FLOOR_OPTIONS.find((o) => o.value === e.target.value);
            if (!opt) return;
            updateConfig({
              ...config,
              floor: { rank: opt.rank, ascension: 'A0' },
            });
          }}
          className="px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] min-w-[20rem]"
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
          <WarPlacementTable
            result={activeRun.result}
            championLookup={championLookup}
            slotsPerPlayer={5}
          />
        )}
      </section>

      <SharePoolModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        pool={config.pool}
        floor={config.floor}
      />
    </div>
  );
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
          </span>
        </div>
        <span className="text-xs text-[var(--color-ink-soft)]">
          imports replace your current pool + floor
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
