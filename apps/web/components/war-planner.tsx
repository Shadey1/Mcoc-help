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
import { loadWarConfig, saveWarConfig, type WarConfig } from '../lib/war-storage';
import { fetchShare } from '../lib/share-client';
import { WarPoolTickbox } from './war-pool-tickbox';
import {
  WarShareInput,
  extractShareId,
  type WarShareRowStatus,
} from './war-share-input';
import { WarPlacementTable } from './war-placement-table';

/**
 * Floor options — rank only. Ascension is dropped from the floor UI; the
 * engine still takes a {rank, ascension} pair but we always pass A0, which
 * is the permissive setting (anything ascended counts). Keeping ascension
 * out of the user-facing axis avoids confusing combos like "R5 A2 floor"
 * that would exclude legit defenders.
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

type LoadedRoster = {
  label: string | null;
  champions: ChampionState[];
};

export function WarPlanner({ champions }: { champions: Champion[] }) {
  const [config, setConfig] = useState<WarConfig | null>(null);
  const [statuses, setStatuses] = useState<WarShareRowStatus[]>([]);
  const [rosters, setRosters] = useState<Map<number, LoadedRoster>>(new Map());
  const [result, setResult] = useState<WarResult | null>(null);
  const [running, setRunning] = useState(false);
  // Default collapsed if the pool has already been filled (returning user),
  // expanded if empty (first-time use).
  const [poolExpanded, setPoolExpanded] = useState<boolean | null>(null);

  useEffect(() => {
    const loaded = loadWarConfig();
    setConfig(loaded);
    setPoolExpanded(loaded.pool.length === 0);
  }, []);

  const championLookup = useMemo(
    () => new Map(champions.map((c) => [c.id, c])),
    [champions],
  );

  if (!config || poolExpanded === null) {
    return (
      <div className="text-sm text-[var(--color-ink-soft)] italic">Loading…</div>
    );
  }

  function updateConfig(next: WarConfig) {
    setConfig(next);
    saveWarConfig(next);
    // Editing a URL invalidates that row's loaded state; clear all results
    // to force a re-fetch on next process.
    setResult(null);
  }

  async function process() {
    if (!config) return;
    setRunning(true);
    setResult(null);
    const newStatuses: WarShareRowStatus[] = config.players.map((row) =>
      row.url.trim() ? { state: 'loading' as const } : { state: 'empty' as const },
    );
    setStatuses(newStatuses);

    const newRosters = new Map<number, LoadedRoster>();
    const players: WarPlayer[] = [];

    // Fetch all in parallel. Failures don't block other rows.
    await Promise.all(
      config.players.map(async (row, idx) => {
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
            id: `slot-${idx}`,
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

    setStatuses(newStatuses);
    setRosters(newRosters);

    if (players.length === 0) {
      setRunning(false);
      return;
    }

    const r = assignWar({
      defenderPool: new Set(config.pool),
      floor: config.floor,
      players,
      slotsPerPlayer: 5,
    });
    setResult(r);
    setRunning(false);
  }

  const poolSet = new Set(config.pool);
  const hasUrls = config.players.some((p) => p.url.trim().length > 0);
  const canProcess = hasUrls && poolSet.size > 0 && !running;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div>
          <h2 className="editorial-heading text-2xl mb-1">
            1. Pick your defender pool
          </h2>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
            Tick every champion your alliance considers war-worthy on defence.
            Minimum 50 (the war size); 60+ suggested to give headroom over
            roster gaps. Saved locally; collapses to a single line once filled.
          </p>
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
          <h2 className="editorial-heading text-2xl mb-1">
            2. Minimum rank
          </h2>
          <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
            Champions below this rank won&apos;t count as placeable. R4 is a
            sensible default for most rosters — drop to R3 if your alliance
            sits at that tier.
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
            One row per alliance member. Use their share URL from mcoc.help.
            If their in-game name differs from the label baked into the share,
            type it in the name field. Up to 10 members per war.
          </p>
        </div>
        <WarShareInput
          rows={config.players}
          statuses={statuses}
          onChange={(rows) => updateConfig({ ...config, players: rows })}
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={() => void process()}
            disabled={!canProcess}
            className="px-6 py-3 bg-[var(--color-marvel-impact)] text-white font-medium rounded shadow-lg disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed disabled:shadow-none transition-colors"
          >
            {running ? 'Loading & placing…' : 'Generate placements'}
          </button>
          {!hasUrls && (
            <p className="text-xs text-[var(--color-ink-soft)]">
              Paste at least one share URL above.
            </p>
          )}
          {hasUrls && poolSet.size === 0 && (
            <p className="text-xs text-[var(--color-marvel-impact)]">
              Tick at least one champion in your defender pool.
            </p>
          )}
        </div>

        {result && (
          <WarPlacementTable
            result={result}
            championLookup={championLookup}
            slotsPerPlayer={5}
          />
        )}
      </section>
    </div>
  );
}
