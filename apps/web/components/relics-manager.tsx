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
  type R6StatcastLevel,
  type R6StatcastRank,
  type RelicInventory,
  type RelicLevel,
  type RelicOverrides,
  type RelicRank,
  type RelicStarTier,
  type ScoredRelicMove,
  type SpecialRelicEntry,
  type SpecialRelicId,
} from '@prestige-tools/engine';
import { loadRelics, saveRelics, type RelicStateBundle } from '../lib/relics-storage';
import { useRelicOverrides } from '../lib/relic-overrides-context';
import { Collapsible } from './collapsible';

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

/** Standard statcast BHR routed by tier — mirrors the engine helper.
 *  When `getOverride` is supplied and returns a value, that overrides
 *  both the curve and the α flag. */
function statcastBHRByTier(
  starTier: RelicStarTier,
  rank: RelicRank,
  level: RelicLevel,
  getOverride?: (rank: R6StatcastRank, sig: R6StatcastLevel) => number | undefined,
): number | null {
  if (starTier === 7) return standardStatcastBHR({ rank, level });
  if (rank < 1 || rank > 5) return null;
  const r6Rank = `R${rank}` as R6StatcastRank;
  const override = getOverride?.(r6Rank, level);
  if (override !== undefined) return override;
  return r6StatcastRating(r6Rank, level).rating;
}

/** True if the rendered value comes from the alpha-fill curve (not verified
 *  and not user-overridden). Used to tag cells with an "α" superscript. */
function statcastIsAlphaByTier(
  starTier: RelicStarTier,
  rank: RelicRank,
  level: RelicLevel,
  getOverride?: (rank: R6StatcastRank, sig: R6StatcastLevel) => number | undefined,
): boolean {
  if (starTier === 7) return false;
  if (rank < 1 || rank > 5) return false;
  const r6Rank = `R${rank}` as R6StatcastRank;
  if (getOverride?.(r6Rank, level) !== undefined) return false;
  return r6StatcastRating(r6Rank, level).isAlpha;
}

export function RelicsManager() {
  const [bundle, setBundle] = useState<RelicStateBundle | null>(null);
  const overridesCtx = useRelicOverrides();

  // Build the override callback shape the engine expects from the context.
  const engineOverrides = useMemo<RelicOverrides>(
    () => ({
      statcast6: (rank, sig) => overridesCtx.getStatcast6(rank, sig),
      battlecast6: (id, rank, sig) =>
        overridesCtx.getBattlecast6(id, rank, sig),
    }),
    [overridesCtx],
  );

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
  const avgBHR = useMemo(
    () => relicTop30Average(inventory, engineOverrides),
    [inventory, engineOverrides],
  );
  const moves = useMemo(
    () => enumerateRelicMoves(inventory, top30Cutoff, engineOverrides),
    [inventory, top30Cutoff, engineOverrides],
  );

  // ── Mutators (closures; no hooks) ───────────────────────────────────────

  function setCount(
    starTier: RelicStarTier,
    rank: RelicRank,
    level: RelicLevel,
    count: number,
  ) {
    setBundle((current) => {
      if (!current) return current;
      const filtered = current.inventory.standardCounts.filter(
        (e) => !(e.starTier === starTier && e.rank === rank && e.level === level),
      );
      const next =
        count > 0
          ? [...filtered, { starTier, rank, level, count }]
          : filtered;
      return {
        ...current,
        inventory: { ...current.inventory, standardCounts: next },
      };
    });
  }

  function getCount(
    starTier: RelicStarTier,
    rank: RelicRank,
    level: RelicLevel,
  ): number {
    return (
      inventory.standardCounts.find(
        (e) =>
          e.starTier === starTier && e.rank === rank && e.level === level,
      )?.count ?? 0
    );
  }

  function countTierTotal(starTier: RelicStarTier): number {
    return inventory.standardCounts
      .filter((e) => e.starTier === starTier)
      .reduce((sum, e) => sum + e.count, 0);
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
      {/* Standard 7★ statcast — at top per "7★ first" */}
      <Collapsible
        title="Standard 7★ statcast relics"
        summary={`${countTierTotal(7)} owned · counts contribute to top-30`}
      >
        <StatcastGrid
          starTier={7}
          ranks={VISIBLE_RANKS_7STAR}
          getCount={getCount}
          setCount={setCount}
          getOverride={undefined}
          clearOverride={undefined}
          setOverride={undefined}
        />
      </Collapsible>

      {/* 7★ specials (Cosmic Egg) */}
      <Collapsible
        title="7★ Cosmic Egg & specials"
        summary={`${inventory.specials.length} added`}
      >
        <SpecialsSection
          specials={inventory.specials}
          addSpecial={addSpecial}
          updateSpecial={updateSpecial}
          removeSpecial={removeSpecial}
        />
      </Collapsible>

      {/* Standard 6★ statcast */}
      <Collapsible
        title="Standard 6★ statcast relics"
        summary={`${countTierTotal(6)} owned · α cells are estimates`}
      >
        <StatcastGrid
          starTier={6}
          ranks={VISIBLE_RANKS_6STAR}
          getCount={getCount}
          setCount={setCount}
          getOverride={overridesCtx.getStatcast6}
          clearOverride={overridesCtx.clearStatcast6}
          setOverride={overridesCtx.setStatcast6}
        />
      </Collapsible>

      {/* 6★ Battlecasts (after both statcast tiers so the page reads 7★ → 6★) */}
      <Collapsible
        title="6★ Battlecast relics"
        summary={`${inventory.battlecasts6Star.length} added · MCOCHUB α + your overrides`}
      >
        <Battlecast6Section
          entries={inventory.battlecasts6Star}
          addEntry={addBattlecast6}
          updateEntry={updateBattlecast6}
          removeEntry={removeBattlecast6}
          getOverride={overridesCtx.getBattlecast6}
          clearOverride={overridesCtx.clearBattlecast6}
          setOverride={overridesCtx.setBattlecast6}
        />
      </Collapsible>

      {/* Cutoff */}
      <Collapsible
        title="Top-30 cutoff"
        summary={top30Cutoff > 0 ? `${top30Cutoff.toLocaleString()} BHR` : 'not set'}
      >
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
      </Collapsible>

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

// ─── Section sub-components (Collapsible wraps these) ─────────────────────

type StatcastGridProps = {
  starTier: RelicStarTier;
  ranks: readonly RelicRank[];
  getCount: (
    starTier: RelicStarTier,
    rank: RelicRank,
    level: RelicLevel,
  ) => number;
  setCount: (
    starTier: RelicStarTier,
    rank: RelicRank,
    level: RelicLevel,
    count: number,
  ) => void;
  /** Override hooks — only passed for 6★ (7★ has verified curves). */
  getOverride?: (rank: R6StatcastRank, sig: R6StatcastLevel) => number | undefined;
  clearOverride?: (rank: R6StatcastRank, sig: R6StatcastLevel) => void;
  setOverride?: (
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
    value: number,
  ) => void;
};

function StatcastGrid({
  starTier,
  ranks,
  getCount,
  setCount,
  getOverride,
  clearOverride,
  setOverride,
}: StatcastGridProps) {
  const editable = Boolean(getOverride && setOverride && clearOverride);
  return (
    <>
      <p className="text-sm text-[var(--color-ink-soft)] mb-3 max-w-2xl">
        Rank and sig count. Enter how many you own at each state.
        {starTier === 6 && (
          <>
            {' '}α cells are estimates — click the value to pin your own
            reading.
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
            {ranks.map((rank) => (
              <tr key={rank}>
                <td className="px-2 py-2 text-sm font-semibold text-right">
                  R{rank}
                </td>
                {LEVELS.map((level) => {
                  const bhr = statcastBHRByTier(starTier, rank, level, getOverride);
                  const isAlpha = statcastIsAlphaByTier(
                    starTier,
                    rank,
                    level,
                    getOverride,
                  );
                  const r6Rank = `R${rank}` as R6StatcastRank;
                  const r6Sig = level;
                  const overridden =
                    starTier === 6 &&
                    getOverride?.(r6Rank, r6Sig) !== undefined;
                  return (
                    <td
                      key={level}
                      className="px-1 py-2 text-center align-top"
                    >
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={getCount(starTier, rank, level) || ''}
                        placeholder="0"
                        onChange={(e) =>
                          setCount(
                            starTier,
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
                      <div className="mt-1">
                        {editable ? (
                          <ValueEditor
                            value={bhr}
                            isAlpha={isAlpha}
                            isOverridden={overridden}
                            onSave={(v) => setOverride!(r6Rank, r6Sig, v)}
                            onClear={() => clearOverride!(r6Rank, r6Sig)}
                          />
                        ) : (
                          <span
                            className={`text-[10px] ${
                              isAlpha
                                ? 'text-[var(--color-ink-soft)]/60 italic'
                                : 'text-[var(--color-ink-soft)]'
                            }`}
                          >
                            {bhr !== null ? bhr.toLocaleString() : '—'}
                            {isAlpha && (
                              <sup className="ml-0.5 not-italic">α</sup>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type SpecialsSectionProps = {
  specials: readonly SpecialRelicEntry[];
  addSpecial: (entry: SpecialRelicEntry) => void;
  updateSpecial: (index: number, partial: Partial<SpecialRelicEntry>) => void;
  removeSpecial: (index: number) => void;
};

function SpecialsSection({
  specials,
  addSpecial,
  updateSpecial,
  removeSpecial,
}: SpecialsSectionProps) {
  return (
    <>
      <p className="text-sm text-[var(--color-ink-soft)] mb-3 max-w-2xl">
        Champion-bound 7★ relics with their own scaling (Cosmic Egg today).
        Each tracked individually.
      </p>
      {specials.length === 0 && (
        <p className="text-sm text-[var(--color-ink-soft)] mb-3 italic">
          None added yet.
        </p>
      )}
      <ul className="space-y-2 mb-3">
        {specials.map((s, i) => {
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
                Sig
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
                      {l}
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
      {!specials.some((s) => s.id === 'cosmic-egg') && (
        <button
          onClick={() => addSpecial({ id: 'cosmic-egg', rank: 1, level: 0 })}
          className="text-sm px-3 py-1 border border-[var(--color-ink-soft)] rounded hover:bg-[var(--color-ink)] hover:text-white transition"
          type="button"
        >
          + Add 7★ Cosmic Egg
        </button>
      )}
    </>
  );
}

type Battlecast6SectionProps = {
  entries: readonly Battlecast6Entry[];
  addEntry: (entry: Battlecast6Entry) => void;
  updateEntry: (index: number, partial: Partial<Battlecast6Entry>) => void;
  removeEntry: (index: number) => void;
  getOverride: (
    id: string,
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
  ) => number | undefined;
  clearOverride: (
    id: string,
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
  ) => void;
  setOverride: (
    id: string,
    rank: R6StatcastRank,
    sig: R6StatcastLevel,
    value: number,
  ) => void;
};

function Battlecast6Section({
  entries,
  addEntry,
  updateEntry,
  removeEntry,
  getOverride,
  clearOverride,
  setOverride,
}: Battlecast6SectionProps) {
  return (
    <>
      <p className="text-sm text-[var(--color-ink-soft)] mb-3 max-w-2xl">
        Champion-bound battlecasts at 6★. Each tracked individually. Most
        curves are α (MCOCHUB community ranking, state guessed) — click
        the BHR to pin your own reading. A relic only contributes to top-30
        when the engine has data (verified, α, or your override) at its
        current (rank, sig).
      </p>
      {entries.length === 0 && (
        <p className="text-sm text-[var(--color-ink-soft)] mb-3 italic">
          None added yet.
        </p>
      )}
      <ul className="space-y-2 mb-3">
        {entries.map((bc, i) => {
          const r6Rank = `R${bc.rank}` as R6StatcastRank;
          const r6Sig = bc.level;
          const override = getOverride(bc.id, r6Rank, r6Sig);
          const rating =
            override !== undefined
              ? { rating: override, source: 'override' as const }
              : battlecast6Rating(bc.id as Battlecast6Id, r6Rank, r6Sig);
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
                  updateEntry(i, { id: e.target.value })
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
                    updateEntry(i, {
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
                    updateEntry(i, {
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
              <div className="text-xs">
                <ValueEditor
                  value={rating ? rating.rating : null}
                  isAlpha={
                    rating
                      ? rating.source === 'mcochub-alpha'
                      : false
                  }
                  isOverridden={
                    rating ? rating.source === 'override' : false
                  }
                  onSave={(v) => setOverride(bc.id, r6Rank, r6Sig, v)}
                  onClear={() => clearOverride(bc.id, r6Rank, r6Sig)}
                />
              </div>
              <button
                onClick={() => removeEntry(i)}
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
        onClick={() => addEntry({ id: 'cosmic-egg', rank: 1, level: 0 })}
        className="text-sm px-3 py-1 border border-[var(--color-ink-soft)] rounded hover:bg-[var(--color-ink)] hover:text-white transition"
        type="button"
      >
        + Add a 6★ battlecast
      </button>
    </>
  );
}

/**
 * Inline editable BHR display. Default: shows the value (or "—") with an
 * α superscript and a ✎ affordance. Click → expands into an input + save
 * + clear + cancel. Used for 6★ statcast cells and 6★ battlecast rows.
 */
function ValueEditor({
  value,
  isAlpha,
  isOverridden,
  onSave,
  onClear,
}: {
  value: number | null;
  isAlpha: boolean;
  isOverridden: boolean;
  onSave: (v: number) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          if (Number.isFinite(n) && n > 0) onSave(Math.round(n));
          setEditing(false);
        }}
        className="inline-flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={value?.toString() ?? ''}
          autoFocus
          className="numeric w-16 px-1 py-0.5 text-[11px] border border-[var(--color-marvel-impact)] rounded"
        />
        <button
          type="submit"
          className="text-[10px] px-1 bg-[var(--color-marvel-impact)] text-white rounded"
          title="Save"
        >
          ✓
        </button>
        {isOverridden && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setEditing(false);
            }}
            className="text-[10px] px-1 border border-[var(--color-rule)] rounded"
            title="Remove override"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[10px] px-0.5 text-[var(--color-ink-soft)]"
          title="Cancel"
        >
          ✗
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value?.toString() ?? '');
        setEditing(true);
      }}
      className={`inline-flex items-baseline gap-0.5 text-[10px] ${
        isOverridden
          ? 'text-emerald-700 font-medium'
          : isAlpha
            ? 'text-[var(--color-ink-soft)]/60 italic'
            : 'text-[var(--color-ink-soft)]'
      } hover:text-[var(--color-marvel-impact)] transition-colors`}
      title={
        isOverridden
          ? 'Pinned by you. Click to edit or remove.'
          : isAlpha
            ? 'Alpha estimate. Click to pin your reading.'
            : 'Verified value. Click to override.'
      }
    >
      <span>{value !== null ? value.toLocaleString() : '—'}</span>
      {isOverridden ? (
        <span className="not-italic">•</span>
      ) : isAlpha ? (
        <sup className="not-italic">α</sup>
      ) : null}
    </button>
  );
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
