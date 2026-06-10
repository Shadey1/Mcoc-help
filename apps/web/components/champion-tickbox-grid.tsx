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

/**
 * State-mode IDs. Each represents a common-batch-state that a player would
 * want to bulk-tag champions with. The set is deliberately small — the realistic
 * "I have a bunch of these" states for MCOC, not the full combinatorial space.
 * Anything outside this list (R4 sig 100 A1 etc.) goes through the picker.
 */
type StateMode =
  | 'floor'
  | 'r3-max'
  | 'r4-sig0'
  | 'r4-max-a0'
  | 'r4-max-a1'
  | 'r4-max-a2'
  | 'r5-sig0'
  | 'r5-max-a0'
  | 'r5-max-a1'
  | 'r5-max-a2';

type ModeDef = {
  label: string;
  badge: string; // short tag shown on each ticked row
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  /**
   * Whether this state is user-confirmed. The 'floor' mode is the I-don't-
   * know-precise-state default — entries go in at R3 sig 0 A0 but are excluded
   * from atomic-move recommendations until the user confirms state. Every
   * other mode is user-confirmed by definition.
   */
  confirmed: boolean;
};

const MODES: Record<StateMode, ModeDef> = {
  'floor':     { label: 'Floor (default)', badge: 'floor',  rank: 3, sig: 0,   ascension: 'A0', confirmed: false },
  'r3-max':    { label: 'R3 sig 200',      badge: 'R3/200', rank: 3, sig: 200, ascension: 'A0', confirmed: true  },
  'r4-sig0':   { label: 'R4 sig 0',        badge: 'R4/0',   rank: 4, sig: 0,   ascension: 'A0', confirmed: true  },
  'r4-max-a0': { label: 'R4 sig 200 A0',   badge: 'R4/A0',  rank: 4, sig: 200, ascension: 'A0', confirmed: true  },
  'r4-max-a1': { label: 'R4 sig 200 A1',   badge: 'R4/A1',  rank: 4, sig: 200, ascension: 'A1', confirmed: true  },
  'r4-max-a2': { label: 'R4 sig 200 A2',   badge: 'R4/A2',  rank: 4, sig: 200, ascension: 'A2', confirmed: true  },
  'r5-sig0':   { label: 'R5 sig 0',        badge: 'R5/0',   rank: 5, sig: 0,   ascension: 'A0', confirmed: true  },
  'r5-max-a0': { label: 'R5 sig 200 A0',   badge: 'R5/A0',  rank: 5, sig: 200, ascension: 'A0', confirmed: true  },
  'r5-max-a1': { label: 'R5 sig 200 A1',   badge: 'R5/A1',  rank: 5, sig: 200, ascension: 'A1', confirmed: true  },
  'r5-max-a2': { label: 'R5 sig 200 A2',   badge: 'R5/A2',  rank: 5, sig: 200, ascension: 'A2', confirmed: true  },
};

const MODE_ORDER: StateMode[] = [
  'floor',
  'r3-max',
  'r4-sig0',
  'r4-max-a0',
  'r4-max-a1',
  'r4-max-a2',
  'r5-sig0',
  'r5-max-a0',
  'r5-max-a1',
  'r5-max-a2',
];

type TickboxGridProps = {
  champions: Champion[];
  /** Champion IDs already in the roster — shown ticked + locked. */
  ownedIds: Set<string>;
  /** Receives the constructed states on Add. */
  onAdd: (states: ChampionState[]) => void;
};

/**
 * Bulk add surface — six class-grouped columns with checkboxes, plus a
 * state-mode pill row that determines what state each tick gets recorded at.
 *
 * Workflow ("pick a mode, tick many"):
 *   1. Pick a mode pill (defaults to Floor = R3 sig 0 A0 unconfirmed)
 *   2. Tick the champions you own at that state
 *   3. Switch mode pill — your existing ticks keep their original state
 *   4. Tick more champions at the new mode
 *   5. Hit Add — every ticked champion enters the roster at its tick-time state
 *
 * Each ticked champion shows a small badge with its assigned state so it's
 * always obvious what will be added. Non-ascendable champions ticked under
 * A1/A2 mode are silently coerced to A0 (matches bulk-paste behaviour).
 */
export function ChampionTickboxGrid({ champions, ownedIds, onAdd }: TickboxGridProps) {
  // championId → the state mode it was ticked under
  const [selected, setSelected] = useState<Map<string, StateMode>>(new Map());
  const [activeMode, setActiveMode] = useState<StateMode>('floor');
  const [search, setSearch] = useState('');
  // Classes whose champion list is currently collapsed. Default-open
  // (empty set) so first-time use is unchanged; the user folds each class
  // away once they're done ticking it.
  const [collapsed, setCollapsed] = useState<Set<ChampionClass>>(new Set());

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
    if (ownedIds.has(id)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        // Already ticked — un-tick. To change state, un-tick then re-tick
        // under the new mode. Avoids surprise silent-state-change behaviour.
        next.delete(id);
      } else {
        next.set(id, activeMode);
      }
      return next;
    });
  }

  function tickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    setSelected((prev) => {
      const next = new Map(prev);
      for (const c of list) {
        if (!ownedIds.has(c.id) && !next.has(c.id) && matchesSearch(c)) {
          next.set(c.id, activeMode);
        }
      }
      return next;
    });
  }

  function untickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    setSelected((prev) => {
      const next = new Map(prev);
      for (const c of list) next.delete(c.id);
      return next;
    });
  }

  /**
   * Resolve mode → state per champion, applying A1/A2 → A0 coercion for
   * non-ascendable champions.
   */
  function handleAdd() {
    if (selected.size === 0) return;
    const championById = new Map(champions.map((c) => [c.id, c]));
    const states: ChampionState[] = [];
    for (const [championId, mode] of selected) {
      const def = MODES[mode];
      const champion = championById.get(championId);
      if (!champion) continue;
      const ascension =
        champion.ascendable || def.ascension === 'A0' ? def.ascension : 'A0';
      states.push({
        championId,
        rank: def.rank,
        sig: def.sig,
        ascension,
        stateConfirmed: def.confirmed,
        addedVia: 'tickbox',
      });
    }
    onAdd(states);
    setSelected(new Map());
  }

  // Per-mode counts for the Add button breakdown
  const counts = useMemo(() => {
    const c: Record<StateMode, number> = {
      'floor': 0,
      'r3-max': 0,
      'r4-sig0': 0,
      'r4-max-a0': 0,
      'r4-max-a1': 0,
      'r4-max-a2': 0,
      'r5-sig0': 0,
      'r5-max-a0': 0,
      'r5-max-a1': 0,
      'r5-max-a2': 0,
    };
    for (const m of selected.values()) c[m]++;
    return c;
  }, [selected]);

  const totalCount = selected.size;
  const modesWithCounts = MODE_ORDER.filter((m) => counts[m] > 0);

  return (
    <div className="space-y-4">
      {/* State-mode pill row */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-[var(--color-ink-soft)] mr-1">
            Adding at:
          </span>
          {MODE_ORDER.map((mode) => {
            const def = MODES[mode];
            const isActive = activeMode === mode;
            const isFloor = mode === 'floor';
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setActiveMode(mode)}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  isActive
                    ? 'bg-[var(--color-marvel-impact)] text-white border-[var(--color-marvel-impact)] font-medium'
                    : isFloor
                      ? 'bg-[var(--color-paper)] border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:border-[var(--color-marvel-impact)]'
                      : 'bg-[var(--color-paper)] border-[var(--color-rule)] hover:border-[var(--color-marvel-impact)]'
                }`}
                title={
                  isFloor
                    ? 'Default — added at R3 sig 0 A0, not state-confirmed. Excluded from atomic-move recommendations.'
                    : `Tick to add at ${def.label} with state confirmed.`
                }
              >
                {def.label}
                {counts[mode] > 0 && (
                  <span className="ml-1.5 opacity-75">({counts[mode]})</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--color-ink-soft)]">
          Pick a mode, tick the champions you own at that state, switch mode for
          the next batch. Each ticked champion keeps the mode it was ticked
          under. Non-ascendable champions ticked at A1/A2 are added as A0.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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
            onClick={() => setSelected(new Map())}
            className="px-3 py-2 text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] underline"
          >
            Clear {totalCount} selected
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CLASS_ORDER.map((klass) => {
          const list = (byClass.get(klass) ?? []).filter(matchesSearch);
          const ownedInClass = list.filter((c) => ownedIds.has(c.id)).length;
          const selectedInClass = list.filter((c) => selected.has(c.id)).length;
          const claimableInClass = list.length - ownedInClass;
          const allClaimed = claimableInClass > 0 && selectedInClass === claimableInClass;

          const isCollapsed = collapsed.has(klass);
          return (
            <div
              key={klass}
              className="border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-rule)]">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(klass)) next.delete(klass);
                      else next.add(klass);
                      return next;
                    })
                  }
                  className="font-medium text-sm flex items-center gap-2 hover:text-[var(--color-marvel-impact)]"
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Show champions' : 'Hide champions'}
                >
                  <span className="text-xs font-mono w-3 text-[var(--color-ink-soft)]">
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  <span>{klass}</span>
                  <span className="text-xs text-[var(--color-ink-soft)] font-normal">
                    {ownedInClass + selectedInClass} / {list.length}
                  </span>
                </button>
                {claimableInClass > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      allClaimed ? untickAllInClass(klass) : tickAllInClass(klass)
                    }
                    className="text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
                  >
                    {allClaimed ? 'untick all' : `tick all (${MODES[activeMode].badge})`}
                  </button>
                )}
              </div>
              {!isCollapsed && (
              <ul className="max-h-96 overflow-y-auto">
                {list.length === 0 && (
                  <li className="px-3 py-4 text-xs text-[var(--color-ink-soft)] text-center">
                    {search ? 'no matches' : 'no champions'}
                  </li>
                )}
                {list.map((c) => {
                  const owned = ownedIds.has(c.id);
                  const tickMode = selected.get(c.id);
                  const ticked = owned || tickMode !== undefined;
                  // For non-ascendable champions ticked at A1/A2, show coerced
                  // badge so the user sees what they're actually committing to.
                  const effectiveBadge = tickMode
                    ? !c.ascendable && MODES[tickMode].ascension !== 'A0'
                      ? `R${MODES[tickMode].rank}/A0`
                      : MODES[tickMode].badge
                    : null;
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
                      {effectiveBadge && effectiveBadge !== 'floor' && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-marvel-impact)]/15 text-[var(--color-marvel-impact)] shrink-0"
                          title={`Will be added at ${MODES[tickMode!].label}${
                            !c.ascendable && MODES[tickMode!].ascension !== 'A0'
                              ? ' (non-ascendable → coerced to A0)'
                              : ''
                          }`}
                        >
                          {effectiveBadge}
                        </span>
                      )}
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
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-4 flex justify-center pt-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={totalCount === 0}
          className="px-6 py-3 bg-[var(--color-marvel-impact)] text-white font-medium rounded shadow-lg disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed disabled:shadow-none transition-colors flex flex-col items-center gap-0.5"
        >
          <span>
            {totalCount === 0
              ? 'Tick champions to add'
              : `Add ${totalCount} ${totalCount === 1 ? 'champion' : 'champions'}`}
          </span>
          {totalCount > 0 && modesWithCounts.length > 1 && (
            <span className="text-[10px] font-normal opacity-80">
              {modesWithCounts.map((m) => `${counts[m]} ${MODES[m].badge}`).join(' · ')}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
