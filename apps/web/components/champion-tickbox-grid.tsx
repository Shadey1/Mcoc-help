'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionClass, ChampionState } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';

const CLASS_ORDER: ChampionClass[] = [
  'Mutant',
  'Skill',
  'Science',
  'Mystic',
  'Cosmic',
  'Tech',
];

type TickboxGridProps = {
  champions: Champion[];
  /** Champion IDs already in the roster — shown ticked + locked. */
  ownedIds: Set<string>;
  /**
   * Called when the user clicks "Add N champions". Returns identity-only
   * states (R3 sig 0 A0, stateConfirmed: false, addedVia: 'tickbox').
   */
  onAdd: (states: ChampionState[]) => void;
};

/**
 * The bulk identity-add surface — six columns of class-grouped champion
 * thumbnails with checkboxes. Lets a player claim everything they own
 * without supplying state. State gets filled in later via the roster table
 * for the handful of champions that aren't at R3 sig 0 A0 floor.
 *
 * Design notes (architecture-v5 §scope, deviating from the original picker-
 * only flow):
 *   - Search box at the top filters across all classes for fast lookup.
 *   - Already-owned champions appear pre-ticked + locked so the visual scan
 *     is "what haven't I claimed yet?". Removal happens in the roster table,
 *     not here, to avoid accidental loss of confirmed state.
 *   - "Tick all in {class}" provides a power-user fast path. Default behaviour
 *     stays opt-in (one tick per champion) so no one accidentally claims
 *     the whole 254-entry catalogue.
 *   - The "Add N champions" button is persistent at the bottom so the user
 *     can see selection count while scrolling.
 */
export function ChampionTickboxGrid({ champions, ownedIds, onAdd }: TickboxGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Group + sort once per champion list
  const byClass = useMemo(() => {
    const map = new Map<ChampionClass, Champion[]>();
    for (const c of CLASS_ORDER) map.set(c, []);
    for (const c of champions) {
      map.get(c.class)?.push(c);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [champions]);

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (c: Champion): boolean => {
    if (!searchLower) return true;
    return c.name.toLowerCase().includes(searchLower);
  };

  function toggle(id: string) {
    if (ownedIds.has(id)) return; // locked
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function tickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of list) {
        if (!ownedIds.has(c.id) && matchesSearch(c)) next.add(c.id);
      }
      return next;
    });
  }

  function untickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of list) next.delete(c.id);
      return next;
    });
  }

  function handleAdd() {
    if (selected.size === 0) return;
    const states: ChampionState[] = Array.from(selected).map((championId) => ({
      championId,
      rank: 3,
      sig: 0,
      ascension: 'A0',
      stateConfirmed: false,
      addedVia: 'tickbox',
    }));
    onAdd(states);
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            placeholder="Search champions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          />
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] underline"
            >
              Clear {selected.size} selected
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--color-ink-soft)]">
          Tick everyone you own. Added at R3 sig 0 A0 by default — refine
          rank/sig/ascension from the roster table once you&apos;re done.
          Champions already in your roster are locked.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CLASS_ORDER.map((klass) => {
          const list = (byClass.get(klass) ?? []).filter(matchesSearch);
          const ownedInClass = list.filter((c) => ownedIds.has(c.id)).length;
          const selectedInClass = list.filter((c) => selected.has(c.id)).length;
          const claimableInClass = list.length - ownedInClass;
          const allClaimed = claimableInClass > 0 && selectedInClass === claimableInClass;

          return (
            <div
              key={klass}
              className="border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-rule)]">
                <div className="font-medium text-sm flex items-center gap-2">
                  <span>{klass}</span>
                  <span className="text-xs text-[var(--color-ink-soft)] font-normal">
                    {ownedInClass + selectedInClass} / {list.length}
                  </span>
                </div>
                {claimableInClass > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      allClaimed ? untickAllInClass(klass) : tickAllInClass(klass)
                    }
                    className="text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
                  >
                    {allClaimed ? 'untick all' : 'tick all'}
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
                  const owned = ownedIds.has(c.id);
                  const ticked = owned || selected.has(c.id);
                  return (
                    <li
                      key={c.id}
                      className={`flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-rule)]/40 last:border-b-0 ${
                        owned
                          ? 'bg-[var(--color-paper-soft)]/60 text-[var(--color-ink-soft)]'
                          : 'hover:bg-[var(--color-paper-soft)] cursor-pointer'
                      }`}
                      onClick={() => toggle(c.id)}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={owned}
                        readOnly
                        className="cursor-pointer disabled:cursor-not-allowed"
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
                      {owned && (
                        <span
                          className="text-[10px] text-[var(--color-ink-soft)] shrink-0"
                          title="Already in your roster"
                        >
                          in roster
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 flex justify-center pt-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={selected.size === 0}
          className="px-6 py-3 bg-[var(--color-marvel-impact)] text-white font-medium rounded shadow-lg disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed disabled:shadow-none transition-colors"
        >
          {selected.size === 0
            ? 'Tick champions to add'
            : `Add ${selected.size} ${selected.size === 1 ? 'champion' : 'champions'}`}
        </button>
      </div>
    </div>
  );
}
