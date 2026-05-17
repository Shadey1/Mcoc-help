'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  calculateBHR,
  calculateChampionPrestige,
  type Champion,
  type ChampionState,
} from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { formatBHR } from '../lib/format';

type SortMode = 'bhr' | 'name' | 'class';

type SharedRosterViewProps = {
  champions: Champion[];
  roster: ChampionState[];
  label: string | null;
  expiresAt: string;
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
  onImport,
}: SharedRosterViewProps) {
  const [sortMode, setSortMode] = useState<SortMode>('bhr');

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

  // Display rows — same data, resorted per sortMode
  const rows = useMemo(() => {
    const list = [...bhrSortedRows];
    switch (sortMode) {
      case 'bhr':
        return list; // already BHR-desc
      case 'name':
        return list.sort((a, b) => a.champion.name.localeCompare(b.champion.name));
      case 'class':
        // Class A→Z, then rank desc, then name A→Z within rank.
        // Useful for AW planning — group by class to scan availability,
        // strongest rank first, alphabetical within a rank tier.
        return list.sort((a, b) => {
          const cls = a.champion.class.localeCompare(b.champion.class);
          if (cls !== 0) return cls;
          if (a.state.rank !== b.state.rank) return b.state.rank - a.state.rank;
          return a.champion.name.localeCompare(b.champion.name);
        });
    }
  }, [bhrSortedRows, sortMode]);

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
        <p className="text-sm text-[var(--color-ink-soft)]">
          View-only · expires {new Date(expiresAt).toLocaleDateString()}
        </p>
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
          Import this roster →
        </button>
      </section>

      <section className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
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
