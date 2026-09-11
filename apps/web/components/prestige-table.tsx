'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ChampionClass } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { ClassIcon, classColors } from './class-icon';

export type PrestigeRow = {
  id: string;
  name: string;
  klass: ChampionClass;
  ascendable: boolean;
  portraitUrl: string | null;
  a0: number;
  a1: number | null;
  a2: number | null;
  ceiling: number;
};

type SortColumn = 'name' | 'klass' | 'a0' | 'a1' | 'a2' | 'ceiling';
type SortDirection = 'asc' | 'desc';
type AscendableFilter = 'all' | 'ascendable' | 'non-ascendable';

const ALL_CLASSES: ChampionClass[] = [
  'Cosmic',
  'Mutant',
  'Mystic',
  'Science',
  'Skill',
  'Tech',
];

export function PrestigeTable({ rows }: { rows: PrestigeRow[] }) {
  const [activeClasses, setActiveClasses] = useState<Set<ChampionClass>>(
    new Set(ALL_CLASSES),
  );
  const [ascFilter, setAscFilter] = useState<AscendableFilter>('all');
  const [search, setSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('ceiling');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => activeClasses.has(r.klass))
      .filter((r) => {
        if (ascFilter === 'all') return true;
        if (ascFilter === 'ascendable') return r.ascendable;
        return !r.ascendable;
      })
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true));
  }, [rows, activeClasses, ascFilter, search]);

  const sorted = useMemo(() => {
    const s = [...filtered];
    const dir = sortDirection === 'asc' ? 1 : -1;
    s.sort((a, b) => {
      let cmp: number;
      switch (sortColumn) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'klass':
          cmp = a.klass.localeCompare(b.klass);
          break;
        // Numeric columns treat nulls as -Infinity so they sink under desc /
        // float to the top under asc — either way the ascendable rows sit
        // together in the numeric band.
        case 'a0':
          cmp = a.a0 - b.a0;
          break;
        case 'a1':
          cmp = (a.a1 ?? -Infinity) - (b.a1 ?? -Infinity);
          break;
        case 'a2':
          cmp = (a.a2 ?? -Infinity) - (b.a2 ?? -Infinity);
          break;
        case 'ceiling':
          cmp = a.ceiling - b.ceiling;
          break;
      }
      // Stable tie-break on name so re-sorts don't jitter identical values.
      if (cmp === 0) return a.name.localeCompare(b.name);
      return cmp * dir;
    });
    return s;
  }, [filtered, sortColumn, sortDirection]);

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      // Numeric columns default to desc (highest prestige first);
      // text columns default to asc (A→Z reads naturally).
      setSortDirection(col === 'name' || col === 'klass' ? 'asc' : 'desc');
    }
  }

  function toggleClass(klass: ChampionClass) {
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(klass)) next.delete(klass);
      else next.add(klass);
      return next;
    });
  }

  function setAllClasses(on: boolean) {
    setActiveClasses(on ? new Set(ALL_CLASSES) : new Set());
  }

  const allClassesActive = activeClasses.size === ALL_CLASSES.length;
  const filtersActive = !allClassesActive || ascFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mr-2">
            Class
          </span>
          {ALL_CLASSES.map((klass) => {
            const active = activeClasses.has(klass);
            const { bg } = classColors(klass);
            return (
              <button
                key={klass}
                type="button"
                onClick={() => toggleClass(klass)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium transition-colors ${
                  active
                    ? 'border-[var(--color-ink)] bg-[var(--color-paper)]'
                    : 'border-[var(--color-rule)] bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
                }`}
                style={active ? { boxShadow: `inset 0 -2px 0 ${bg}` } : undefined}
              >
                <ClassIcon klass={klass} size={14} />
                {klass}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setAllClasses(!allClassesActive)}
            className="ml-2 text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
          >
            {allClassesActive ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mr-2">
            Ascendable
          </span>
          {(['all', 'ascendable', 'non-ascendable'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setAscFilter(opt)}
              className={`px-2 py-1 rounded border text-xs font-medium transition-colors ${
                ascFilter === opt
                  ? 'border-[var(--color-ink)] bg-[var(--color-paper)]'
                  : 'border-[var(--color-rule)] bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
              }`}
            >
              {opt === 'all' ? 'All' : opt === 'ascendable' ? 'Ascendable only' : 'Non-ascendable only'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search champion…"
            aria-label="Search champions by name"
            className="flex-1 min-w-[200px] max-w-md px-3 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          {filtersActive && (
            <span className="text-xs text-[var(--color-ink-soft)] numeric">
              {sorted.length} of {rows.length} match
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto border border-[var(--color-rule)] rounded">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)] text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
            <tr>
              <SortableHeader
                column="name"
                label="Champion"
                align="left"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                column="klass"
                label="Class"
                align="left"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                column="a0"
                label="A0"
                align="right"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                column="a1"
                label="A1"
                align="right"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                column="a2"
                label="A2"
                align="right"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableHeader
                column="ceiling"
                label="Ceiling"
                align="right"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className="border-b border-[var(--color-rule)] last:border-b-0 hover:bg-[var(--color-paper-soft)]"
              >
                <td className="p-2">
                  <Link
                    href={`/champions/${r.id}/`}
                    className="flex items-center gap-2 hover:text-[var(--color-marvel-impact)]"
                  >
                    <ChampionPortrait
                      name={r.name}
                      klass={r.klass}
                      portraitUrl={r.portraitUrl}
                      size={32}
                      showClassOverlay={false}
                    />
                    <span className="font-medium">{r.name}</span>
                  </Link>
                </td>
                <td className="p-2">
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-soft)]">
                    <ClassIcon klass={r.klass} size={12} />
                    {r.klass}
                  </span>
                </td>
                <td className="p-2 text-right numeric">{r.a0.toLocaleString()}</td>
                <td className="p-2 text-right numeric text-[var(--color-ink-soft)]">
                  {r.a1 !== null ? r.a1.toLocaleString() : '—'}
                </td>
                <td className="p-2 text-right numeric text-[var(--color-ink-soft)]">
                  {r.a2 !== null ? r.a2.toLocaleString() : '—'}
                </td>
                <td className="p-2 text-right numeric font-medium text-[var(--color-marvel-editorial)]">
                  {r.ceiling.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="py-12 text-center text-[var(--color-ink-soft)] italic">
          No champions match the current filters.
        </div>
      )}
    </div>
  );
}

function SortableHeader({
  column,
  label,
  align,
  sortColumn,
  sortDirection,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align: 'left' | 'right';
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (col: SortColumn) => void;
}) {
  const active = sortColumn === column;
  const arrow = active ? (sortDirection === 'asc' ? '↑' : '↓') : '';
  const alignCls = align === 'left' ? 'text-left' : 'text-right';
  return (
    <th className={`${alignCls} p-2 font-medium`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`hover:text-[var(--color-marvel-impact)] transition-colors ${
          active ? 'text-[var(--color-marvel-editorial)]' : ''
        }`}
      >
        {label}
        {arrow && <span className="ml-1 numeric">{arrow}</span>}
      </button>
    </th>
  );
}
