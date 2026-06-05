'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
  battlecast6Rating,
  enumerateRelicMoves,
  r6StatcastRating,
  relicTop30Average,
  specialRelicBHR,
  standardStatcastBHR,
  type Battlecast6Entry,
  type Battlecast6Id,
  type R6StatcastRank,
  type RelicInventory,
  type RelicLevel,
  type RelicRank,
  type RelicStarTier,
  type ScoredRelicMove,
  type SpecialRelicEntry,
  type SpecialRelicId,
} from '@prestige-tools/engine';
import { loadRelics, saveRelics, type RelicStateBundle } from '../lib/relics-storage';

// Only R1 and R2 are reachable in-game today for 7★ statcasts; the 6★ side
// also covers R3+. Engine supports R3-R6 for forward compatibility, so the
// grid widens to ALL_RANKS when the active tier is 6★.
const VISIBLE_RANKS_7STAR: readonly RelicRank[] = [1, 2] as const;
const VISIBLE_RANKS_6STAR: readonly RelicRank[] = [1, 2, 3, 4, 5] as const;
const LEVELS: readonly RelicLevel[] = [
  0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200,
] as const;

// All ranks engine supports — used for special-relic dropdowns where the
// Cosmic Egg can be at R5 etc.
const ALL_RANKS: readonly RelicRank[] = [1, 2, 3, 4, 5, 6] as const;
const BATTLECAST_RANKS: readonly RelicRank[] = [1, 2, 3, 4, 5] as const;

const SPECIAL_LIBRARY: Record<SpecialRelicId, { name: string; class: string }> = {
  'cosmic-egg': { name: 'The Cosmic Egg (7★)', class: 'Cosmic' },
};

// Fallback used while bundle is still null (pre-load) so the useMemo calls
// below have something to operate on without conditional execution.
const EMPTY_INVENTORY: RelicInventory = {
  standardCounts: [],
  specials: [],
  battlecasts6Star: [],
};

/** Standard statcast BHR routed by tier — mirrors the engine helper. */
function statcastBHRByTier(
  starTier: RelicStarTier,
  rank: RelicRank,
  level: RelicLevel,
): number | null {
  if (starTier === 7) return standardStatcastBHR({ rank, level });
  if (rank < 1 || rank > 5) return null;
  const result = r6StatcastRating(
    `R${rank}` as R6StatcastRank,
    level,
  );
  return result.rating;
}

function statcastIsAlphaByTier(
  starTier: RelicStarTier,
  rank: RelicRank,
  level: RelicLevel,
): boolean {
  if (starTier === 7) return false;
  if (rank < 1 || rank > 5) return false;
  return r6StatcastRating(`R${rank}` as R6StatcastRank, level).isAlpha;
}

export function RelicsManager() {
  const [bundle, setBundle] = useState<RelicStateBundle | null>(null);
  const [activeTier, setActiveTier] = useState<RelicStarTier>(7);

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
      inventory.specials.length +
      inventory.battlecasts6Star.length,
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
        (e) => !(e.starTier === activeTier && e.rank === rank && e.level === level),
      );
      const next =
        count > 0
          ? [...filtered, { starTier: activeTier, rank, level, count }]
          : filtered;
      return {
        ...current,
        inventory: { ...current.inventory, standardCounts: next },
      };
    });
  }

  function getCount(rank: RelicRank, level: RelicLevel): number {
    return (
      inventory.standardCounts.find(
        (e) =>
          e.starTier === activeTier && e.rank === rank && e.level === level,
      )?.count ?? 0
    );
  }

  function addBattlecast6(entry: Battlecast6Entry) {
    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        inventory: {
          ...current.inventory,
          battlecasts6Star: [...current.inventory.battlecasts6Star, entry],
        },
      };
    });
  }

  function removeBattlecast6(index: number) {
    setBundle((current) => {
      if (!current) return current;
      return {
        ...current,
        inventory: {
          ...current.inventory,
          battlecasts6Star: current.inventory.battlecasts6Star.filter(
            (_, i) => i !== index,
          ),
        },
      };
    });
  }

  function updateBattlecast6(index: number, partial: Partial<Battlecast6Entry>) {
    setBundle((current) => {
      if (!current) return current;
      const next = current.inventory.battlecasts6Star.map((b, i) =>
        i === index ? { ...b, ...partial } : b,
      );
      return {
        ...current,
        inventory: { ...current.inventory, battlecasts6Star: next },
      };
    });
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
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
          <h2 className="editorial-heading text-2xl">
            Standard {activeTier}★ statcast relics
          </h2>
          <div className="inline-flex border border-[var(--color-rule)] rounded overflow-hidden text-xs">
            {([7, 6] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setActiveTier(tier)}
                className={`px-3 py-1.5 ${
                  activeTier === tier
                    ? 'bg-[var(--color-marvel-impact)] text-white font-medium'
                    : 'bg-[var(--color-paper)] hover:bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
                }`}
              >
                {tier}★
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-[var(--color-ink-soft)] mb-4 max-w-2xl">
          Rank and sig count. Enter how many you own at each state.
          {activeTier === 6 && (
            <>
              {' '}
              6★ cells marked α are estimates — submit verified readings
              via the form above.
            </>
          )}
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
                    sig {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(activeTier === 7 ? VISIBLE_RANKS_7STAR : VISIBLE_RANKS_6STAR).map(
                (rank) => (
                  <tr key={rank}>
                    <td className="px-2 py-2 text-sm font-semibold text-right">
                      R{rank}
                    </td>
                    {LEVELS.map((level) => {
                      const bhr = statcastBHRByTier(activeTier, rank, level);
                      const isAlpha = statcastIsAlphaByTier(
                        activeTier,
                        rank,
                        level,
                      );
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
                              bhr !== null
                                ? `${bhr} BHR per relic${isAlpha ? ' (α)' : ''}`
                                : 'no data'
                            }
                          />
                          <div
                            className={`text-[10px] mt-1 ${
                              isAlpha
                                ? 'text-[var(--color-ink-soft)]/60 italic'
                                : 'text-[var(--color-ink-soft)]'
                            }`}
                          >
                            {bhr !== null ? bhr.toLocaleString() : '—'}
                            {isAlpha && <sup className="ml-0.5 not-italic">α</sup>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ),
              )}
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
            + Add 7★ Cosmic Egg
          </button>
        )}
      </section>

      {/* 6★ Battlecasts — tracked individually */}
      <section>
        <h2 className="editorial-heading text-2xl mb-1">
          6★ Battlecast relics
        </h2>
        <p className="text-sm text-[var(--color-ink-soft)] mb-4 max-w-2xl">
          Champion-bound battlecasts at 6★. Each tracked individually.
          Most curves are α (MCOCHUB community ranking, state guessed) —
          a relic only contributes to top-30 when the engine has data at
          its current (rank, sig).
        </p>

        {inventory.battlecasts6Star.length === 0 && (
          <p className="text-sm text-[var(--color-ink-soft)] mb-3 italic">
            None added yet.
          </p>
        )}

        <ul className="space-y-2 mb-3">
          {inventory.battlecasts6Star.map((bc, i) => {
            const rating = battlecast6Rating(
              bc.id as Battlecast6Id,
              `R${bc.rank}` as R6StatcastRank,
              bc.level,
            );
            const defName =
              BATTLECAST_6STAR_CATALOG[bc.id as Battlecast6Id]?.name ?? bc.id;
            return (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 text-sm p-2 border border-[var(--color-ink-soft)] rounded"
              >
                <select
                  value={bc.id}
                  onChange={(e) =>
                    updateBattlecast6(i, { id: e.target.value })
                  }
                  className="border border-[var(--color-ink-soft)] rounded px-1 py-0.5 text-sm font-medium"
                >
                  {BATTLECAST_6STAR_IDS.map((bid) => (
                    <option key={bid} value={bid}>
                      {BATTLECAST_6STAR_CATALOG[bid].name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs">
                  Rank
                  <select
                    value={bc.rank}
                    onChange={(e) =>
                      updateBattlecast6(i, {
                        rank: parseInt(e.target.value, 10) as RelicRank,
                      })
                    }
                    className="border border-[var(--color-ink-soft)] rounded px-1 py-0.5 text-xs"
                  >
                    {BATTLECAST_RANKS.map((r) => (
                      <option key={r} value={r}>
                        R{r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-xs">
                  Sig
                  <select
                    value={bc.level}
                    onChange={(e) =>
                      updateBattlecast6(i, {
                        level: parseInt(e.target.value, 10) as RelicLevel,
                      })
                    }
                    className="border border-[var(--color-ink-soft)] rounded px-1 py-0.5 text-xs"
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  {rating === null
                    ? '— no data for this state'
                    : `${rating.rating.toLocaleString()} BHR${
                        rating.source === 'mcochub-alpha' ? ' (α)' : ''
                      }`}
                </span>
                <button
                  onClick={() => removeBattlecast6(i)}
                  className="text-xs text-red-700 hover:underline ml-auto"
                  type="button"
                  title={`Remove ${defName}`}
                >
                  remove
                </button>
              </li>
            );
          })}
        </ul>

        <button
          onClick={() =>
            addBattlecast6({ id: 'cosmic-egg', rank: 1, level: 0 })
          }
          className="text-sm px-3 py-1 border border-[var(--color-ink-soft)] rounded hover:bg-[var(--color-ink)] hover:text-white transition"
          type="button"
        >
          + Add a 6★ battlecast
        </button>
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

function battlecast6Name(id: string): string {
  return BATTLECAST_6STAR_CATALOG[id as Battlecast6Id]?.name ?? id;
}

function RelicMoveCard({ move }: { move: ScoredRelicMove }) {
  const m = move.move;
  let title: string;
  switch (m.kind) {
    case 'level-up':
      title = `Level up a ${m.starTier}★ R${m.from.rank} L${m.from.level} relic → L${m.toLevel}`;
      break;
    case 'rank-up':
      title = `Rank up a ${m.starTier}★ R${m.from.rank} L${m.from.level} relic → R${m.toRank}`;
      break;
    case 'special-level-up':
      title = `Level up ${specialName(m.id)} → L${m.toLevel}`;
      break;
    case 'special-rank-up':
      title = `Rank up ${specialName(m.id)} → R${m.toRank}`;
      break;
    case 'battlecast6-level-up':
      title = `Level up ${battlecast6Name(m.id)} (6★) → L${m.toLevel}`;
      break;
    case 'battlecast6-rank-up':
      title = `Rank up ${battlecast6Name(m.id)} (6★) → R${m.toRank}`;
      break;
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
