'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionClass } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';

const CLASS_ORDER: ChampionClass[] = [
  'Mutant',
  'Skill',
  'Science',
  'Mystic',
  'Cosmic',
  'Tech',
];

type Props = {
  champions: Champion[];
  /** Champion IDs currently in the defender pool. */
  selected: Set<string>;
  /** Called with the new pool whenever it changes. */
  onChange: (next: Set<string>) => void;
  /** Expanded/collapsed state controlled by parent so the planner can
   *  default it based on whether the pool has been filled before. */
  expanded: boolean;
  onToggleExpanded: () => void;
};

/**
 * Defender-pool tickbox — class-grouped grid for selecting which champions
 * the alliance considers war-worthy defenders. Pure tick/untick, no state
 * mode — the pool is rank-agnostic. State filtering happens at assignment
 * time via the min-rank floor.
 *
 * Officer ticks ≥50 (war size); 60+ is suggested for roster gap headroom.
 * Collapses to a single-line summary once filled so it doesn't dominate
 * the page on subsequent visits.
 */
export function WarPoolTickbox({
  champions,
  selected,
  onChange,
  expanded,
  onToggleExpanded,
}: Props) {
  const [search, setSearch] = useState('');

  const byClass = useMemo(() => {
    const map = new Map<ChampionClass, Champion[]>();
    for (const c of CLASS_ORDER) map.set(c, []);
    for (const c of champions) map.get(c.class)?.push(c);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [champions]);

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (c: Champion): boolean =>
    !searchLower || c.name.toLowerCase().includes(searchLower);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function tickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    const next = new Set(selected);
    for (const c of list) if (matchesSearch(c)) next.add(c.id);
    onChange(next);
  }

  function untickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    const next = new Set(selected);
    for (const c of list) next.delete(c.id);
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  const totalCount = selected.size;
  // <50 = below war size (red). 50-59 = ok but no headroom (neutral).
  // 60+ = comfortable headroom (positive).
  const countColor =
    totalCount < 50
      ? 'text-[var(--color-marvel-impact)]'
      : totalCount < 60
        ? 'text-[var(--color-ink)]'
        : 'text-emerald-700';
  const countNote =
    totalCount < 50
      ? `${50 - totalCount} more to reach the minimum (50 = war size)`
      : totalCount < 60
        ? `${60 - totalCount} more for suggested headroom (60+)`
        : `${totalCount} ticked — comfortable headroom`;

  return (
    <div className="space-y-4 border border-[var(--color-rule)] rounded">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-paper-soft)] transition-colors text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-baseline gap-3">
          <span className={`numeric text-2xl font-medium ${countColor}`}>
            {totalCount}
          </span>
          <span className="text-xs text-[var(--color-ink-soft)]">
            {countNote}
          </span>
        </div>
        <span className="text-xs text-[var(--color-ink-soft)] font-mono">
          {expanded ? '▼ hide' : '▶ edit'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search champions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
            />
            {totalCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="px-3 py-2 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] underline whitespace-nowrap"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CLASS_ORDER.map((klass) => {
              const list = (byClass.get(klass) ?? []).filter(matchesSearch);
              const selectedInClass = list.filter((c) => selected.has(c.id)).length;
              const allTicked = list.length > 0 && selectedInClass === list.length;

              return (
                <div
                  key={klass}
                  className="border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-rule)]">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <span>{klass}</span>
                      <span className="text-xs text-[var(--color-ink-soft)] font-normal">
                        {selectedInClass} / {list.length}
                      </span>
                    </div>
                    {list.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          allTicked ? untickAllInClass(klass) : tickAllInClass(klass)
                        }
                        className="text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
                      >
                        {allTicked ? 'untick all' : 'tick all'}
                      </button>
                    )}
                  </div>
                  <ul className="max-h-96 overflow-y-auto">
                    {list.length === 0 && (
                      <li className="px-3 py-4 text-xs text-[var(--color-ink-soft)] text-center">
                        {search ? 'no matches' : 'no champions'}
                      </li>
                    )}
                    {list.map((c) => {
                      const ticked = selected.has(c.id);
                      return (
                        <li
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-rule)]/40 last:border-b-0 hover:bg-[var(--color-paper-soft)] cursor-pointer"
                          onClick={() => toggle(c.id)}
                        >
                          <input
                            type="checkbox"
                            checked={ticked}
                            readOnly
                            className="cursor-pointer"
                            tabIndex={-1}
                          />
                          <ChampionPortrait
                            name={c.name}
                            klass={c.class}
                            portraitUrl={c.portraitUrl ?? null}
                            size={28}
                          />
                          <span className="text-xs flex-1 truncate" title={c.name}>
                            {c.name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
