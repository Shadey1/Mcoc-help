'use client';

import { useMemo, useRef, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';

type RosterPickerProps = {
  /** Full champion catalog from the seed file */
  champions: Champion[];
  /** Champion IDs already in the roster (suppressed from typeahead) */
  ownedIds: Set<string>;
  /** Called when the user finalises adding a champion at a state */
  onAdd: (state: ChampionState) => void;
};

/**
 * Two-step picker:
 *   1. Typeahead to select the champion
 *   2. Form (rank / sig / ascension) to set the state
 *
 * Ascension dropdown is restricted to A0 for non-ascendable champions —
 * the engine would silently accept higher states, but the UI prevents
 * users from claiming impossible ascensions.
 */
export function RosterPicker({ champions, ownedIds, onAdd }: RosterPickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Champion | null>(null);
  const [rank, setRank] = useState<3 | 4 | 5>(4);
  const [sig, setSig] = useState(200);
  const [ascension, setAscension] = useState<'A0' | 'A1' | 'A2'>('A0');
  const inputRef = useRef<HTMLInputElement>(null);

  // Search index — case-insensitive substring match, excludes owned champions
  const searchResults = useMemo(() => {
    if (!query.trim() || selected) return [];
    const q = query.toLowerCase();
    return champions
      .filter((c) => !ownedIds.has(c.id) && c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [champions, ownedIds, query, selected]);

  function handleSelect(champion: Champion) {
    setSelected(champion);
    setQuery(champion.name);
    // Reset state to sensible defaults for this champion
    setRank(4);
    setSig(200);
    setAscension('A0');
  }

  function handleAdd() {
    if (!selected) return;
    onAdd({
      championId: selected.id,
      rank,
      sig,
      ascension,
      stateConfirmed: true,
      addedVia: 'manual',
    });
    // Reset for next add
    setSelected(null);
    setQuery('');
    setRank(4);
    setSig(200);
    setAscension('A0');
    inputRef.current?.focus();
  }

  function handleCancel() {
    setSelected(null);
    setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <label className="block text-sm font-medium mb-1">Add a champion</label>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) setSelected(null);
          }}
          placeholder="Start typing a name…"
          className="w-full px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          autoComplete="off"
        />
        {searchResults.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-[var(--color-paper)] border border-[var(--color-rule)] rounded shadow-md max-h-72 overflow-y-auto">
            {searchResults.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--color-paper-soft)] flex items-center justify-between"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-[var(--color-ink-soft)] flex gap-2">
                    <span>{c.class}</span>
                    {c.ascendable && (
                      <span className="text-[var(--color-marvel-editorial)] font-medium">
                        asc
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="border border-[var(--color-rule)] rounded p-4 bg-[var(--color-paper-soft)] space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-[var(--color-marvel-editorial)]">{selected.name}</strong>
            <span className="text-xs text-[var(--color-ink-soft)]">{selected.class}</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                Rank
              </span>
              <select
                value={rank}
                onChange={(e) => setRank(Number(e.target.value) as 3 | 4 | 5)}
                className="mt-1 w-full px-2 py-1 border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
              >
                <option value={5}>R5</option>
                <option value={4}>R4</option>
                <option value={3}>R3</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                Sig
              </span>
              <select
                value={sig}
                onChange={(e) => setSig(Number(e.target.value))}
                className="mt-1 w-full px-2 py-1 border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
              >
                {[0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                Ascension
              </span>
              <select
                value={ascension}
                onChange={(e) =>
                  setAscension(e.target.value as 'A0' | 'A1' | 'A2')
                }
                disabled={!selected.ascendable}
                className="mt-1 w-full px-2 py-1 border border-[var(--color-rule)] rounded bg-[var(--color-paper)] disabled:opacity-50"
              >
                <option value="A0">A0</option>
                {selected.ascendable && (
                  <>
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                  </>
                )}
              </select>
            </label>
          </div>

          {!selected.ascendable && (
            <p className="text-xs text-[var(--color-ink-soft)] italic">
              This champion isn&apos;t in any current or upcoming ascension pool.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
            >
              Add to roster
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
