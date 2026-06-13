'use client';

import { useMemo, useState } from 'react';
import type { Champion, ChampionClass, WarTier } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import {
  poolIdSet,
  poolSize,
  setPoolTier,
  type WarPool,
} from '../lib/war-storage';

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
  pool: WarPool;
  onChange: (next: WarPool) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
};

/**
 * Defender-pool tickbox — class-grouped grid with a per-champion tier
 * picker. Three mutually-exclusive buttons per row:
 *
 *   S — Strong (must-place meta defender)
 *   M — Mid    (preferred fill)
 *   B — Base   (diversity / gap filler, picked last)
 *
 * Click an unset tier to set it; click the active tier to remove the
 * champion from the pool. Sums show per-tier counts; the overall total
 * still drives the under-50 warning since the pool needs ≥50 across all
 * tiers to seat a full BG.
 */
export function WarPoolTickbox({
  champions,
  pool,
  onChange,
  expanded,
  onToggleExpanded,
}: Props) {
  const [search, setSearch] = useState('');

  const byClass = useMemo(() => {
    const map = new Map<ChampionClass, Champion[]>();
    for (const c of CLASS_ORDER) map.set(c, []);
    for (const c of champions) map.get(c.class)?.push(c);
    for (const list of map.values())
      list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [champions]);

  const selectedIds = useMemo(() => poolIdSet(pool), [pool]);
  const tierLookup = useMemo(() => {
    const m = new Map<string, WarTier>();
    for (const id of pool.strong) m.set(id, 'strong');
    for (const id of pool.mid) m.set(id, 'mid');
    for (const id of pool.base) m.set(id, 'base');
    return m;
  }, [pool]);

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (c: Champion): boolean =>
    !searchLower || c.name.toLowerCase().includes(searchLower);

  function cycleOrToggle(championId: string, tier: WarTier) {
    const current = tierLookup.get(championId);
    onChange(setPoolTier(pool, championId, current === tier ? null : tier));
  }

  function tickAllInClass(klass: ChampionClass, tier: WarTier) {
    const list = byClass.get(klass) ?? [];
    let next = pool;
    for (const c of list) {
      if (!matchesSearch(c)) continue;
      // Don't downgrade a stronger pick — if it's already Strong and the
      // caller is bulk-applying Mid, leave Strong alone.
      const current = tierLookup.get(c.id);
      if (current && tierRank(current) <= tierRank(tier)) continue;
      next = setPoolTier(next, c.id, tier);
    }
    onChange(next);
  }

  function untickAllInClass(klass: ChampionClass) {
    const list = byClass.get(klass) ?? [];
    let next = pool;
    for (const c of list) next = setPoolTier(next, c.id, null);
    onChange(next);
  }

  function clearAll() {
    onChange({ strong: [], mid: [], base: [] });
  }

  const totalCount = poolSize(pool);
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
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className={`numeric text-2xl font-medium ${countColor}`}>
            {totalCount}
          </span>
          <span className="text-xs text-[var(--color-ink-soft)]">
            {countNote}
          </span>
          {totalCount > 0 && (
            <span className="text-xs text-[var(--color-ink-soft)] numeric">
              <span className="text-[var(--color-marvel-impact)] font-medium">
                {pool.strong.length}S
              </span>
              {' · '}
              <span>{pool.mid.length}M</span>
              {' · '}
              <span className="text-[var(--color-ink-soft)]">
                {pool.base.length}B
              </span>
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--color-ink-soft)] font-mono">
          {expanded ? '▼ hide' : '▶ edit'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search champions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[12rem] px-3 py-2 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
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

          <p className="text-xs text-[var(--color-ink-soft)]">
            <span className="text-[var(--color-marvel-impact)] font-medium">
              Strong
            </span>{' '}
            = must-place meta defenders (picked first). <span>Mid</span> =
            preferred fill. <span>Base</span> = diversity gap-fillers (picked
            last). Click an active tier to remove a champ from the pool.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CLASS_ORDER.map((klass) => {
              const list = (byClass.get(klass) ?? []).filter(matchesSearch);
              const selectedInClass = list.filter((c) =>
                selectedIds.has(c.id),
              ).length;

              return (
                <div
                  key={klass}
                  className="border border-[var(--color-rule)] rounded bg-[var(--color-paper)]"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-rule)]">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <span>{klass}</span>
                      <span className="text-xs text-[var(--color-ink-soft)] font-normal">
                        {selectedInClass} / {list.length}
                      </span>
                    </div>
                    {list.length > 0 && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => tickAllInClass(klass, 'mid')}
                          className="text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
                          title="Promote all visible champs in this class to at least Mid"
                        >
                          all → mid
                        </button>
                        <span className="text-[var(--color-ink-soft)]/40">
                          ·
                        </span>
                        <button
                          type="button"
                          onClick={() => untickAllInClass(klass)}
                          className="text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
                        >
                          clear
                        </button>
                      </div>
                    )}
                  </div>
                  <ul className="max-h-96 overflow-y-auto">
                    {list.length === 0 && (
                      <li className="px-3 py-4 text-xs text-[var(--color-ink-soft)] text-center">
                        {search ? 'no matches' : 'no champions'}
                      </li>
                    )}
                    {list.map((c) => {
                      const tier = tierLookup.get(c.id) ?? null;
                      return (
                        <li
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--color-rule)]/40 last:border-b-0 hover:bg-[var(--color-paper-soft)]"
                        >
                          <ChampionPortrait
                            name={c.name}
                            klass={c.class}
                            portraitUrl={c.portraitUrl ?? null}
                            size={28}
                          />
                          <span
                            className="text-xs flex-1 truncate"
                            title={c.name}
                          >
                            {c.name}
                          </span>
                          <TierToggle
                            tier="strong"
                            current={tier}
                            onClick={() => cycleOrToggle(c.id, 'strong')}
                          />
                          <TierToggle
                            tier="mid"
                            current={tier}
                            onClick={() => cycleOrToggle(c.id, 'mid')}
                          />
                          <TierToggle
                            tier="base"
                            current={tier}
                            onClick={() => cycleOrToggle(c.id, 'base')}
                          />
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

function tierRank(tier: WarTier): number {
  return tier === 'strong' ? 0 : tier === 'mid' ? 1 : 2;
}

const TIER_LABEL: Record<WarTier, string> = {
  strong: 'S',
  mid: 'M',
  base: 'B',
};
const TIER_TITLE: Record<WarTier, string> = {
  strong: 'Strong — must-place meta defender',
  mid: 'Mid — preferred fill',
  base: 'Base — diversity gap-filler',
};

function TierToggle({
  tier,
  current,
  onClick,
}: {
  tier: WarTier;
  current: WarTier | null;
  onClick: () => void;
}) {
  const active = current === tier;
  // Tier-specific accent for the active state; neutral border when inactive.
  const activeClass =
    tier === 'strong'
      ? 'bg-[var(--color-marvel-impact)] text-white border-[var(--color-marvel-impact)]'
      : tier === 'mid'
        ? 'bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]'
        : 'bg-[var(--color-ink-soft)] text-[var(--color-paper)] border-[var(--color-ink-soft)]';
  const inactiveClass =
    'border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink-soft)]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 text-[10px] font-medium border rounded transition-colors ${
        active ? activeClass : inactiveClass
      }`}
      title={TIER_TITLE[tier]}
      aria-pressed={active}
      aria-label={`Set ${TIER_TITLE[tier]}`}
    >
      {TIER_LABEL[tier]}
    </button>
  );
}
