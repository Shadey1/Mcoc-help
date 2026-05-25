'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  enumerateRelicMoves,
  relicTop30Average,
  specialRelicBHR,
  standardStatcastBHR,
  type RelicInventory,
  type RelicLevel,
  type RelicRank,
  type ScoredRelicMove,
  type SpecialRelicEntry,
  type SpecialRelicId,
} from '@prestige-tools/engine';
import { loadRelics, saveRelics, type RelicStateBundle } from '../lib/relics-storage';

// Only R1 and R2 are reachable in-game today; engine supports R3-R6 for forward
// compatibility, but exposing those rows in the UI before they exist would be
// noise. When R3+ becomes available we widen this array; engine handles the rest.
const VISIBLE_RANKS: readonly RelicRank[] = [1, 2] as const;
const LEVELS: readonly RelicLevel[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
] as const;

// All ranks engine supports — used for special-relic dropdowns where the
// Cosmic Egg can be at R5 etc.
const ALL_RANKS: readonly RelicRank[] = [1, 2, 3, 4, 5, 6] as const;

const SPECIAL_LIBRARY: Record<SpecialRelicId, { name: string; class: string }> = {
  'cosmic-egg': { name: 'The Cosmic Egg', class: 'Cosmic' },
};

// Fallback used while bundle is still null (pre-load) so the useMemo calls
// below have something to operate on without conditional execution.
const EMPTY_INVENTORY: RelicInventory = { standardCounts: [], specials: [] };

export function RelicsManager() {
  const [bundle, setBundle] = useState<RelicStateBundle | null>(null);

  // Load once on mount
  useEffect(() => {
    setBundle(loadRelics());
  }, []);

  // Save on every change (skipped when bundle is null)
  useEffect(() => {
    if (bundle) saveRelics(bundle);
  }, [bundle]);

  // ── Derived state (hooks run unconditionally, regardless of bundle null) ──
  //
  // Rules of Hooks: every hook must run on every render in the same order.
  // The early-return for the loading state happens AFTER all hooks; until
  // bundle is loaded we feed the memos an empty inventory.

  const inventory = bundle?.inventory ?? EMPTY_INVENTORY;
  const top30Cutoff = bundle?.top30Cutoff ?? 0;

  const totalCount = useMemo(
    () =>
      inventory.standardCounts.reduce((sum, e) => sum + e.count, 0) +
      inventory.specials.length,
    [inventory],
  );
  const avgBHR = useMemo(() => relicTop30Average(inventory), [inventory]);
  const moves = useMemo(
    () => enumerateRelicMoves(inventory, top30Cutoff),
    [inventory, top30Cutoff],
  );

  // ── Mutators (closures; no hooks) ───────────────────────────────────────

  function setCount(rank: RelicRank, level: RelicLevel, count: number) {
    setBundle((current) => {
      if (!current) return current;
      const filtered = current.inventory.standardCounts.filter(
        (e) => !(e.rank === rank && e.level === level),
      );
      const next = count > 0 ? [...filtered, { rank, level, count }] : filtered;
      return {
        ...current,
        inventory: { ...current.inventory, standardCounts: next },
      };
    });
  }

  function getCount(rank: RelicRank, level: RelicLevel): number {
    return (
      inventory.standardCounts.find((e) => e.rank === rank && e.level === level)
        ?.count ?? 0
    );
  }

  function addSpecial(entry: SpecialRelicEntry) {
    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        inventory: {
          ...current.inventory,
          specials: [...current.inventory.specials, entry],
        },
      };
    });
  }

  function removeSpecial(index: number) {
    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        inventory: {
          ...current.inventory,
          specials: current.inventory.specials.filter((_, i) => i !== index),
        },
      };
    });
  }

  function updateSpecial(index: number, partial: Partial<SpecialRelicEntry>) {
    setBundle((current) => {
      if (!current) return current;
      const specials = current.inventory.specials.map((s, i) =>
        i === index ? { ...s, ...partial } : s,
      );
      return {
        ...current,
        inventory: { ...current.inventory, specials },
      };
    });
  }

  function setCutoff(value: number) {
    setBundle((current) => {
      if (!current) return current;
      return { ...current, top30Cutoff: Math.max(0, value) };
    });
  }

  // ── Loading sentinel (after all hooks) ──────────────────────────────────

  if (!bundle) {
    return <div className="text-[var(--color-ink-soft)]">Loading…</div>;
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      {/* Standard statcast grid */}
      <section>
        <h2 className="editorial-heading text-2xl mb-1">
          Standard 7★ statcast relics
        </h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-4 max-w-2xl">
            Rank and level count. Add how many you own at each state.
        </p>

        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-1 text-xs font-semibold text-[var(--color-ink-soft)] text-right">
                  ↓ Rank
                </th>
                {LEVELS.map((l) => (
                  <th
                    key={l}
                    className="px-1 py-1 text-xs font-semibold text-center w-16 text-[var(--color-ink-soft)]"
                  >
                    L{l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {VISIBLE_RANKS.map((rank) => (
                <tr key={rank}>
                  <td className="px-2 py-2 text-sm font-semibold text-right">
                    R{rank}
                  </td>
                  {LEVELS.map((level) => {
                    const bhr = standardStatcastBHR({ rank, level });
                    return (
                      <td
                        key={level}
                        className="px-1 py-2 text-center align-top"
                      >
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={getCount(rank, level) || ''}
                          placeholder="0"
                          onChange={(e) =>
                            setCount(
                              rank,
                              level,
                              parseInt(e.target.value || '0', 10) || 0,
                            )
                          }
                          className="w-14 text-center text-sm border border-[var(--color-ink-soft)] rounded px-1 py-1"
                          title={
                            bhr !== null ? `${bhr} BHR per relic` : 'no data'
                          }
                        />
                        <div className="text-[10px] text-[var(--color-ink-soft)] mt-1">
                          {bhr !== null ? bhr.toLocaleString() : '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Specials */}
      <section>
        <h2 className="editorial-heading text-2xl mb-1">Special relics</h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-4 max-w-2xl">
          Champion-bound or event relics with their own scaling. Each tracked
          individually since their prestige tables differ from the standard
          curve.
        </p>

        {inventory.specials.length === 0 && (
          <p className="text-sm text-[var(--color-ink-soft)] mb-3 italic">
            None added yet.
          </p>
        )}

        <ul className="space-y-2 mb-3">
          {inventory.specials.map((s, i) => {
            const bhr = specialRelicBHR(s.id, { rank: s.rank, level: s.level });
            return (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 text-sm p-2 border border-[var(--color-ink-soft)] rounded"
              >
                <span className="font-semibold">
                  {SPECIAL_LIBRARY[s.id]?.name ?? s.id}
                </span>
                <label className="flex items-center gap-1 text-xs">
                  Rank
                  <select
                    value={s.rank}
                    onChange={(e) =>
                      updateSpecial(i, {
                        rank: parseInt(e.target.value, 10) as RelicRank,
                      })
                    }
                    className="border border-[var(--color-ink-soft)] rounded px-1 py-0.5 text-xs"
                  >
                    {ALL_RANKS.map((r) => (
                      <option key={r} value={r}>
                        R{r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-xs">
                  Level
                  <select
                    value={s.level}
                    onChange={(e) =>
                      updateSpecial(i, {
                        level: parseInt(e.target.value, 10) as RelicLevel,
                      })
                    }
                    className="border border-[var(--color-ink-soft)] rounded px-1 py-0.5 text-xs"
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        L{l}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {bhr === null
                    ? '— no data for this state'
                    : `${bhr.toLocaleString()} BHR`}
                </span>
                <button
                  onClick={() => removeSpecial(i)}
                  className="text-xs text-red-700 hover:underline ml-auto"
                  type="button"
                >
                  remove
                </button>
              </li>
            );
          })}
        </ul>

        {!inventory.specials.some((s) => s.id === 'cosmic-egg') && (
          <button
            onClick={() =>
              addSpecial({ id: 'cosmic-egg', rank: 1, level: 0 })
            }
            className="text-sm px-3 py-1 border border-[var(--color-ink-soft)] rounded hover:bg-[var(--color-ink)] hover:text-white transition"
            type="button"
          >
            + Add The Cosmic Egg
          </button>
        )}
      </section>

      {/* Cutoff */}
      <section>
        <h2 className="editorial-heading text-2xl mb-1">Top-30 cutoff</h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-3 max-w-2xl">
          The BHR of your 30th-best relic (find it on the in-game Prestige
          page: top 30 relics → bottom row). Moves whose resulting BHR is
          below this won&apos;t affect your prestige average and get hidden.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={top30Cutoff || ''}
            placeholder="0"
            onChange={(e) =>
              setCutoff(parseInt(e.target.value || '0', 10) || 0)
            }
            className="w-32 text-sm border border-[var(--color-ink-soft)] rounded px-2 py-1"
          />
          <span className="text-xs text-[var(--color-ink-soft)]">BHR</span>
        </div>
      </section>

      {/* Summary */}
      <section className="border-t border-[var(--color-ink-soft)] pt-6">
        <h2 className="editorial-heading text-2xl mb-3">Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <SummaryStat label="Total relics" value={totalCount} />
          <SummaryStat
            label="Top-30 avg BHR"
            value={avgBHR > 0 ? avgBHR.toLocaleString() : '—'}
          />
          <SummaryStat
            label="Top-30 cutoff"
            value={top30Cutoff > 0 ? top30Cutoff.toLocaleString() : '—'}
          />
        </div>
      </section>

      {/* Moves */}
      <section>
        <h2 className="editorial-heading text-2xl mb-3">Recommended moves</h2>
        {moves.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
            No relic moves found above your cutoff. Either you have no
            inventory entered yet, your cutoff is set higher than any reachable
            BHR, or you&apos;ve already maxed every relic you own.
          </p>
        ) : (
          <ul className="space-y-2">
            {moves.slice(0, 10).map((m, i) => (
              <RelicMoveCard key={i} move={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <div className="text-xs text-[var(--color-ink-soft)] uppercase tracking-wide">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function specialName(id: SpecialRelicId): string {
  return SPECIAL_LIBRARY[id]?.name ?? id;
}

function RelicMoveCard({ move }: { move: ScoredRelicMove }) {
  const m = move.move;
  let title: string;
  if (m.kind === 'level-up') {
    title = `Level up an R${m.from.rank} L${m.from.level} relic → L${m.toLevel}`;
  } else if (m.kind === 'rank-up') {
    title = `Rank up an R${m.from.rank} L${m.from.level} relic → R${m.toRank}`;
  } else if (m.kind === 'special-level-up') {
    title = `Level up ${specialName(m.id)} → L${m.toLevel}`;
  } else {
    title = `Rank up ${specialName(m.id)} → R${m.toRank}`;
  }

  return (
    <li className="p-3 border border-[var(--color-ink-soft)] rounded">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-lg font-bold text-[var(--color-marvel-red)]">
          +{move.delta.toLocaleString()} BHR
        </div>
      </div>
      <div className="text-xs text-[var(--color-ink-soft)] mt-1">
        {move.beforeBHR.toLocaleString()} → {move.afterBHR.toLocaleString()}
      </div>
      {move.notes && move.notes.length > 0 && (
        <div className="text-xs text-[var(--color-ink-soft)] mt-2 italic">
          {move.notes.join(' ')}
        </div>
      )}
    </li>
  );
}
