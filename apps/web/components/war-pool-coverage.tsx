'use client';

import { useMemo, useState } from 'react';
import {
  effectiveRank,
  type Ascension,
  type Champion,
  type ChampionState,
  type Rank,
} from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';

/**
 * Diagnostic panel that surfaces how well the defender pool fits the BG's
 * combined roster at the current floor.
 *
 * Shows:
 *   - Pool composition: total / eligible (≥1 BG player owns at floor) /
 *     unavailable (in pool but nobody owns at floor — dead weight).
 *   - Suggested additions: champs owned by ≥1 BG player at floor but NOT
 *     in the pool, sorted by owner count desc. One-click "+ Add" puts them
 *     in the pool so the next placement run can include them.
 *
 * Why both: the user's pain point in real runs has been "I expected 40
 * placements but got 30". Almost always the gap is a pool composition
 * problem (50 of 80 pool entries are owned only at R4 A0), not the
 * algorithm. The unavailable count + suggested additions makes the gap
 * explicit and trivially fixable.
 */

type Roster = {
  label: string | null;
  champions: ChampionState[];
};

type WarPoolCoverageProps = {
  champions: Champion[];
  pool: ReadonlySet<string>;
  floor: { rank: Rank; ascension: Ascension };
  /** Rosters for every player loaded into the active BG. */
  rosters: Roster[];
  onAddToPool: (championId: string) => void;
};

const MAX_SUGGESTIONS_VISIBLE = 12;

export function WarPoolCoverage({
  champions,
  pool,
  floor,
  rosters,
  onAddToPool,
}: WarPoolCoverageProps) {
  const [expandAll, setExpandAll] = useState(false);

  const floorTier = effectiveRank(floor.rank, floor.ascension);
  const championLookup = useMemo(
    () => new Map(champions.map((c) => [c.id, c])),
    [champions],
  );

  // For each champion across the BG's rosters, record the highest tier any
  // player holds it at (the algorithm's "best owner" tier) AND the count of
  // players who hold it at ≥ floor.
  const { eligibleAtFloor, ownerCount } = useMemo(() => {
    const eligible = new Set<string>();
    const counts = new Map<string, number>();
    for (const roster of rosters) {
      for (const state of roster.champions) {
        const tier = effectiveRank(state.rank, state.ascension);
        if (tier < floorTier) continue;
        eligible.add(state.championId);
        counts.set(state.championId, (counts.get(state.championId) ?? 0) + 1);
      }
    }
    return { eligibleAtFloor: eligible, ownerCount: counts };
  }, [rosters, floorTier]);

  const stats = useMemo(() => {
    let eligibleInPool = 0;
    let unavailableInPool = 0;
    for (const id of pool) {
      if (eligibleAtFloor.has(id)) eligibleInPool++;
      else unavailableInPool++;
    }
    return {
      total: pool.size,
      eligible: eligibleInPool,
      unavailable: unavailableInPool,
    };
  }, [pool, eligibleAtFloor]);

  const suggestions = useMemo(() => {
    const list: { championId: string; ownerCount: number }[] = [];
    for (const [championId, count] of ownerCount) {
      if (pool.has(championId)) continue;
      list.push({ championId, ownerCount: count });
    }
    list.sort((a, b) => {
      if (a.ownerCount !== b.ownerCount) return b.ownerCount - a.ownerCount;
      const an = championLookup.get(a.championId)?.name ?? a.championId;
      const bn = championLookup.get(b.championId)?.name ?? b.championId;
      return an.localeCompare(bn);
    });
    return list;
  }, [ownerCount, pool, championLookup]);

  if (rosters.length === 0) return null;

  const visible = expandAll
    ? suggestions
    : suggestions.slice(0, MAX_SUGGESTIONS_VISIBLE);

  return (
    <section className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="editorial-heading text-lg">Pool coverage</h3>
        <div className="text-xs text-[var(--color-ink-soft)]">
          Floor: R{floor.rank} {floor.ascension} (effective tier {floorTier})
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="In pool" value={stats.total} />
        <Stat
          label="Eligible at floor"
          value={stats.eligible}
          accent="positive"
        />
        <Stat
          label="Unavailable (dead weight)"
          value={stats.unavailable}
          accent={stats.unavailable > 0 ? 'warn' : undefined}
        />
      </div>

      {stats.unavailable > 0 && (
        <p className="text-xs text-[var(--color-ink-soft)] italic">
          {stats.unavailable} pool champions aren&apos;t owned by anyone in this BG
          at the floor — they sit in the &quot;In pool but unavailable&quot; list
          below the placement table and never contribute. Consider trimming
          them or lowering the floor.
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-rule)] pt-3">
            <div className="text-sm font-medium">
              Suggested additions
              <span className="ml-2 text-xs text-[var(--color-ink-soft)] font-normal">
                ({suggestions.length} champion
                {suggestions.length === 1 ? '' : 's'} owned at floor by this
                BG but not in your pool)
              </span>
            </div>
            {suggestions.length > MAX_SUGGESTIONS_VISIBLE && (
              <button
                type="button"
                onClick={() => setExpandAll((v) => !v)}
                className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
              >
                {expandAll
                  ? `Show top ${MAX_SUGGESTIONS_VISIBLE}`
                  : `Show all ${suggestions.length}`}
              </button>
            )}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {visible.map((s) => {
              const champion = championLookup.get(s.championId);
              return (
                <li
                  key={s.championId}
                  className="flex items-center gap-2 border border-[var(--color-rule)] rounded p-2 bg-[var(--color-paper)]"
                >
                  {champion && (
                    <ChampionPortrait
                      name={champion.name}
                      klass={champion.class}
                      portraitUrl={champion.portraitUrl ?? null}
                      size={32}
                      rarity={null}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight truncate">
                      {champion?.name ?? s.championId}
                    </div>
                    <div className="text-[10px] text-[var(--color-ink-soft)] numeric">
                      {s.ownerCount} owner{s.ownerCount === 1 ? '' : 's'} at floor
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddToPool(s.championId)}
                    className="text-xs px-2 py-1 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] hover:border-[var(--color-marvel-editorial)] transition-colors whitespace-nowrap"
                    title="Add to defender pool"
                  >
                    + Add
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'positive' | 'warn';
}) {
  const valueColor =
    accent === 'positive'
      ? 'text-emerald-700'
      : accent === 'warn'
        ? 'text-[var(--color-marvel-impact)]'
        : 'text-[var(--color-ink)]';
  return (
    <div className="flex flex-col">
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
        {label}
      </div>
      <div className={`text-2xl font-medium numeric ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
