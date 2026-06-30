'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  calculateBHR,
  calculateChampionPrestige,
  type Champion,
  type ChampionClass,
  type ChampionState,
} from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { formatBHR } from '../lib/format';
import type { ShareMode } from '../lib/share-client';

type SortMode = 'bhr' | 'name' | 'class';
type Rank = 3 | 4 | 5;

const ALL_CLASSES: ChampionClass[] = ['Cosmic', 'Mutant', 'Mystic', 'Science', 'Skill', 'Tech'];
const ALL_RANKS: Rank[] = [5, 4, 3];

type SharedRosterViewProps = {
  champions: Champion[];
  roster: ChampionState[];
  label: string | null;
  expiresAt: string;
  /** Defaults to 'snapshot' if the upstream payload didn't carry mode. */
  mode?: ShareMode;
  /** ISO timestamp of the last owner-side update (or createdAt for snapshots). */
  lastSyncedAt?: string;
  /** When true, the page detected a write-token in the URL — render the
   *  import CTA as "Import & sync" so the user knows this device will be
   *  registered as a writer on the share. */
  syncMode?: boolean;
  onImport: () => void;
};

/**
 * Read-only display of a shared roster. Default sort is BHR descending —
 * matches the in-game prestige page convention and gives the cutoff/top-30
 * math the right ordering. User can resort A–Z (alphabetical scan) or by
 * class + rank (Alliance War planning — group by class, R5s first within).
 */
export function SharedRosterView({
  champions,
  roster,
  label,
  expiresAt,
  mode,
  lastSyncedAt,
  syncMode,
  onImport,
}: SharedRosterViewProps) {
  const [sortMode, setSortMode] = useState<SortMode>('bhr');
  // Class/rank filter sets. Empty set = "no filter active for this dimension",
  // which means show everything. Click a chip to add to the set; click again
  // to remove. Filters compose with AND across dimensions, OR within.
  const [classFilter, setClassFilter] = useState<Set<ChampionClass>>(new Set());
  const [rankFilter, setRankFilter] = useState<Set<Rank>>(new Set());

  function toggleClass(c: ChampionClass) {
    setClassFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  function toggleRank(r: Rank) {
    setRankFilter((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  }
  function clearFilters() {
    setClassFilter(new Set());
    setRankFilter(new Set());
  }
  const hasActiveFilters = classFilter.size > 0 || rankFilter.size > 0;

  const championLookup = useMemo(() => {
    const map = new Map<string, Champion>();
    for (const c of champions) map.set(c.id, c);
    return map;
  }, [champions]);

  // BHR-sorted rows — also feeds cutoff/top-30 math (which is always BHR-based)
  const bhrSortedRows = useMemo(() => {
    return roster
      .map((state) => {
        const champion = championLookup.get(state.championId);
        if (!champion) return null;
        return {
          state,
          champion,
          bhr: calculateBHR(champion, state),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.bhr - a.bhr);
  }, [roster, championLookup]);

  // Sorted rows — used for cutoff math (always BHR-sorted, unfiltered).
  // Display rows — sorted by sortMode AND filtered by class/rank.
  const sortedRows = useMemo(() => {
    const list = [...bhrSortedRows];
    switch (sortMode) {
      case 'bhr':
        return list; // already BHR-desc
      case 'name':
        return list.sort((a, b) => a.champion.name.localeCompare(b.champion.name));
      case 'class':
        // Class A→Z, then rank desc, then name A→Z within rank.
        // Useful for AW planning where defenses are class-restricted —
        // group by class so you can scan availability, then rank desc so
        // your strongest options come first, then alphabetical name within
        // a rank tier so champions are predictably ordered.
        return list.sort((a, b) => {
          const cls = a.champion.class.localeCompare(b.champion.class);
          if (cls !== 0) return cls;
          if (a.state.rank !== b.state.rank) return b.state.rank - a.state.rank;
          return a.champion.name.localeCompare(b.champion.name);
        });
    }
  }, [bhrSortedRows, sortMode]);

  const rows = useMemo(() => {
    // Filter only the displayed rows. Top-30 cutoff / prestige math stays
    // calculated from the full roster — filtering is a viewing affordance,
    // not a roster mutation.
    if (classFilter.size === 0 && rankFilter.size === 0) return sortedRows;
    return sortedRows.filter((r) => {
      if (classFilter.size > 0 && !classFilter.has(r.champion.class)) return false;
      if (rankFilter.size > 0 && !rankFilter.has(r.state.rank as Rank)) return false;
      return true;
    });
  }, [sortedRows, classFilter, rankFilter]);

  const prestige = useMemo(
    () => calculateChampionPrestige(roster, championLookup),
    [roster, championLookup],
  );
  const cutoffBHR = bhrSortedRows.length >= 30 ? bhrSortedRows[29]!.bhr : null;

  const dropped = roster.length - bhrSortedRows.length;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
          Shared roster
        </div>
        <h1 className="editorial-heading text-3xl">
          {label ? label : <span className="text-[var(--color-ink-soft)] italic">Anonymous</span>}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-ink-soft)]">
          <span>View-only · expires {new Date(expiresAt).toLocaleDateString()}</span>
          {mode === 'live' && lastSyncedAt && (
            <LiveBadge lastSyncedAt={lastSyncedAt} />
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Top-30 prestige" value={formatBHR(prestige)} accent />
        <SummaryCard label="Champions" value={String(bhrSortedRows.length)} />
        <SummaryCard
          label="Top-30 cutoff"
          value={cutoffBHR !== null ? formatBHR(cutoffBHR) : '—'}
        />
        <SummaryCard label="Highest BHR" value={bhrSortedRows.length > 0 ? formatBHR(bhrSortedRows[0]!.bhr) : '—'} />
      </section>

      {dropped > 0 && (
        <div className="text-xs text-[var(--color-ink-soft)] italic bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-3">
          {dropped} champion{dropped > 1 ? 's' : ''} from this share are not in our
          current seed and have been omitted. This usually means the seed is older than
          the share — refresh or wait for the next seed update.
        </div>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="editorial-heading text-xl">Roster</h2>
          <div className="flex gap-1 bg-[var(--color-paper-soft)] rounded-md p-1 border border-[var(--color-rule)] text-sm">
            <SortButton current={sortMode} value="bhr" onSelect={setSortMode}>
              BHR
            </SortButton>
            <SortButton current={sortMode} value="name" onSelect={setSortMode}>
              A–Z
            </SortButton>
            <SortButton current={sortMode} value="class" onSelect={setSortMode}>
              Class &amp; rank
            </SortButton>
          </div>
        </div>
        <button
          type="button"
          onClick={onImport}
          className="px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
        >
          {syncMode ? 'Import & sync this device →' : 'Import this roster →'}
        </button>
      </section>

      <section className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] w-14">
            Class
          </span>
          {ALL_CLASSES.map((c) => (
            <FilterChip
              key={c}
              active={classFilter.has(c)}
              onClick={() => toggleClass(c)}
            >
              {c}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] w-14">
            Rank
          </span>
          {ALL_RANKS.map((r) => (
            <FilterChip
              key={r}
              active={rankFilter.has(r)}
              onClick={() => toggleRank(r)}
            >
              R{r}
            </FilterChip>
          ))}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-editorial)]"
            >
              clear filters
            </button>
          )}
        </div>
        {hasActiveFilters && rows.length !== bhrSortedRows.length && (
          <div className="text-xs text-[var(--color-ink-soft)]">
            Showing {rows.length} of {bhrSortedRows.length} champions
          </div>
        )}
      </section>

      <section className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10 gap-1.5">
        {rows.map(({ state, champion, bhr }, idx) => (
          <Link
            key={`${state.championId}-${idx}`}
            href={`/champions/${champion.id}/`}
            className="border border-[var(--color-rule)] rounded p-1 bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)] transition-colors flex flex-col text-center"
          >
            <ChampionPortrait
              name={champion.name}
              klass={champion.class}
              portraitUrl={champion.portraitUrl ?? null}
              fill
              showClassOverlay={Boolean(champion.portraitUrl)}
            />
            <div className="mt-1 text-[11px] font-medium leading-tight">
              {champion.name}
            </div>
            <div className="text-[10px] text-[var(--color-ink-soft)] numeric mt-0.5">
              R{state.rank}
              {state.sig > 0 && ` · ${state.sig}`}
              {champion.ascendable && state.ascension !== 'A0' && (
                <span className="text-[var(--color-marvel-editorial)]"> · {state.ascension}</span>
              )}
            </div>
          </Link>
        ))}
      </section>

      <section className="text-xs text-[var(--color-ink-soft)] italic">
        Shared rosters are stored on Cloudflare for 6 months then automatically deleted.
        Your own roster (in this browser&apos;s local storage) is unaffected by viewing this page.
      </section>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`border rounded-lg p-3 ${
        accent
          ? 'border-[var(--color-marvel-impact)] bg-[var(--color-paper-card)]'
          : 'border-[var(--color-rule)] bg-[var(--color-paper-soft)]'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">{label}</div>
      <div className={`numeric mt-1 ${accent ? 'text-2xl font-medium' : 'text-xl'}`}>{value}</div>
    </div>
  );
}

function SortButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: SortMode;
  value: SortMode;
  onSelect: (mode: SortMode) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`px-3 py-1 rounded transition-colors ${
        active
          ? 'bg-[var(--color-paper-card)] border border-[var(--color-ink-soft)]'
          : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-card)]'
      }`}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-[var(--color-marvel-editorial)] text-[var(--color-paper)] border-[var(--color-marvel-editorial)]'
          : 'border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Live-share freshness badge. Shows "Live · synced X ago" with a relative
 * timestamp that updates every 30s, so a recipient leaving the tab open
 * during war planning can tell whether the data is current. The dot is
 * green-pulse to match the convention of "live" indicators elsewhere on
 * the web.
 */
function LiveBadge({ lastSyncedAt }: { lastSyncedAt: string }) {
  const [, force] = useState(0);

  // Re-render every 30s so the relative time stays current. Tied to the
  // lastSyncedAt prop so a re-fetch (which changes the timestamp) resets
  // the timer immediately.
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [lastSyncedAt]);

  const synced = new Date(lastSyncedAt).getTime();
  const ago = formatRelativeAgo(Date.now() - synced);

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--color-paper-soft)] border border-[var(--color-rule)] text-xs"
      title={`Last updated ${new Date(lastSyncedAt).toLocaleString()}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      <span className="font-medium text-[var(--color-ink)]">Live</span>
      <span className="text-[var(--color-ink-soft)]">· synced {ago}</span>
    </span>
  );
}

function formatRelativeAgo(ms: number): string {
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}
