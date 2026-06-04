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
};

/**
 * Defender-pool tickbox — class-grouped grid for selecting which champions
 * the alliance considers war-worthy defenders. Pure tick/untick, no state
 * mode — the pool is rank-agnostic. State filtering happens at assignment
 * time via the min-state floor.
 *
 * Officer ticks 60-70 candidates; the planner then matches each player's
 * roster against this pool. Saved to localStorage so officers don't re-tick
 * every war.
 */
export function WarPoolTickbox({ champions, selected, onChange }: Props) {
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
  // Visual cue: 50 is the bare minimum to fill war, 60-70 is recommended.
  const countColor =
    totalCount < 50
      ? 'text-[var(--color-marvel-impact)]'
      : totalCount < 60
        ? 'text-[var(--color-ink)]'
        : 'text-[var(--color-marvel-impact)]';
  const countNote =
    totalCount < 50
      ? `add ${50 - totalCount} more`
      : totalCount < 60
        ? `${60 - totalCount} more for headroom`
        : `${totalCount} ticked — good headroom over 50`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <div className={`numeric text-2xl font-medium ${countColor}`}>
            {totalCount}
          </div>
          <div className="text-xs text-[var(--color-ink-soft)]">{countNote}</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search champions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
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
  );
}
