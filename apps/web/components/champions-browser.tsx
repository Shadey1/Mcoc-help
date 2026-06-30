'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Champion, ChampionClass } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { ClassIcon, classColors } from './class-icon';
import { displayRarity, rarityLabel } from '../lib/champion-rarity';

type ChampionsBrowserProps = {
  champions: Champion[];
  /** seedId → array of MCOCHUB tags. Champs not in the map have no tags. */
  championTags: Record<string, string[]>;
};

const ALL_CLASSES: ChampionClass[] = [
  'Cosmic',
  'Mutant',
  'Mystic',
  'Science',
  'Skill',
  'Tech',
];

type AscendableFilter = 'all' | 'ascendable' | 'non-ascendable';
type RarityFilter = 'all' | '7-star' | '6-star' | '5-star';

const RARITY_OPTIONS: ReadonlyArray<{ value: RarityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '7-star', label: '7★ only' },
  { value: '6-star', label: '6★ only' },
  { value: '5-star', label: '5★ only' },
];

/**
 * Browseable champion grid with class filter chips, ascendable toggle, and
 * a ★-rating filter that mirrors the portrait-frame rarity.
 * Sorts alphabetically by default.
 */
export function ChampionsBrowser({
  champions,
  championTags,
}: ChampionsBrowserProps) {
  const [activeClasses, setActiveClasses] = useState<Set<ChampionClass>>(
    new Set(ALL_CLASSES),
  );
  const [ascendableFilter, setAscendableFilter] = useState<AscendableFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(false);

  // Tag options: each unique tag with the count of champs carrying it.
  // Sorted by frequency descending so popular filters surface first; ties
  // alpha by name so the order is deterministic across renders.
  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tags of Object.values(championTags)) {
      for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [championTags]);

  const visibleTagOptions = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return tagOptions;
    return tagOptions.filter((t) => t.name.toLowerCase().includes(q));
  }, [tagOptions, tagSearch]);

  const filtered = useMemo(() => {
    return champions
      .filter((c) => activeClasses.has(c.class))
      .filter((c) => {
        if (ascendableFilter === 'all') return true;
        if (ascendableFilter === 'ascendable') return c.ascendable;
        return !c.ascendable;
      })
      .filter((c) => {
        if (rarityFilter === 'all') return true;
        const r = displayRarity(c);
        // Map our internal rarity to filter buckets:
        // 'unreleased' is the cyan "6★ in-game, no 7★ yet" frame.
        if (rarityFilter === '7-star') return r === '7-star';
        if (rarityFilter === '6-star') return r === 'unreleased';
        if (rarityFilter === '5-star') return r === '5-star';
        return true;
      })
      .filter((c) => {
        if (activeTags.size === 0) return true;
        // OR semantics: champion shown if it carries at least one active tag.
        // Picking multiple tags broadens the result set rather than narrowing
        // it — matches how "show me AW: Decay or AW: Sugar Pill defenders"
        // reads naturally for a war planner.
        const tags = championTags[c.id];
        if (!tags) return false;
        for (const t of tags) if (activeTags.has(t)) return true;
        return false;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [champions, activeClasses, ascendableFilter, rarityFilter, activeTags, championTags]);

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function toggleClass(klass: ChampionClass) {
    setActiveClasses((prev) => {
      const next = new Set(prev);
      if (next.has(klass)) {
        next.delete(klass);
      } else {
        next.add(klass);
      }
      return next;
    });
  }

  function setAllClasses(on: boolean) {
    setActiveClasses(on ? new Set(ALL_CLASSES) : new Set());
  }

  const allClassesActive = activeClasses.size === ALL_CLASSES.length;

  return (
    <div className="space-y-6">
      {/* Filters */}
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
                style={
                  active ? { boxShadow: `inset 0 -2px 0 ${bg}` } : undefined
                }
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
              onClick={() => setAscendableFilter(opt)}
              className={`px-2 py-1 rounded border text-xs font-medium transition-colors ${
                ascendableFilter === opt
                  ? 'border-[var(--color-ink)] bg-[var(--color-paper)]'
                  : 'border-[var(--color-rule)] bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
              }`}
            >
              {opt === 'all' ? 'All' : opt === 'ascendable' ? 'Ascendable only' : 'Non-ascendable only'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mr-2">
            Rarity
          </span>
          {RARITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRarityFilter(opt.value)}
              className={`px-2 py-1 rounded border text-xs font-medium transition-colors ${
                rarityFilter === opt.value
                  ? 'border-[var(--color-ink)] bg-[var(--color-paper)]'
                  : 'border-[var(--color-rule)] bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {tagOptions.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTagsExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
                aria-expanded={tagsExpanded}
              >
                Tags
                <span className={`transition-transform ${tagsExpanded ? 'rotate-180' : ''}`}>
                  ▾
                </span>
              </button>
              {activeTags.size > 0 && (
                <>
                  <span className="text-xs text-[var(--color-ink-soft)]">·</span>
                  <span className="text-xs text-[var(--color-marvel-impact)] font-medium">
                    {activeTags.size} selected
                  </span>
                </>
              )}
              {/* Selected tag chips stay visible even when the panel is
                  collapsed so the user can see what's filtering and clear
                  one without re-opening the picker. */}
              {[...activeTags].sort().map((tag) => (
                <button
                  key={`active-${tag}`}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-300 px-2 py-0.5 text-[11px] text-indigo-800 hover:bg-indigo-100"
                >
                  #{tag} <span className="text-indigo-500">×</span>
                </button>
              ))}
              {activeTags.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTags(new Set())}
                  className="ml-1 text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
                >
                  Clear tags
                </button>
              )}
            </div>

            {tagsExpanded && (
              <div className="space-y-2 border border-[var(--color-rule)] rounded-md p-3 bg-[var(--color-paper-soft)]">
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder={`Search ${tagOptions.length} tags…`}
                  className="w-full px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
                />
                <div className="flex flex-wrap gap-1 max-h-56 overflow-y-auto">
                  {visibleTagOptions.map(({ name, count }) => {
                    const active = activeTags.has(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleTag(name)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                          active
                            ? 'bg-indigo-100 border-indigo-400 text-indigo-900'
                            : 'bg-[var(--color-paper)] border-[var(--color-rule)] text-[var(--color-ink-soft)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]'
                        }`}
                      >
                        #{name}
                        <span className="text-[10px] opacity-70 numeric">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                  {visibleTagOptions.length === 0 && (
                    <span className="text-xs text-[var(--color-ink-soft)] italic">
                      No tags match &ldquo;{tagSearch}&rdquo;.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-sm text-[var(--color-ink-soft)]">
        Showing {filtered.length} of {champions.length} champions
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-1.5">
        {filtered.map((c) => {
          const unreleased = c.sevenStarReleased === false;
          const rarity = displayRarity(c);
          const subLabel = rarityLabel(rarity);
          return (
            <Link
              key={c.id}
              href={`/champions/${c.id}/`}
              className={`group border border-[var(--color-rule)] rounded-lg p-1.5 bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)] transition-colors flex flex-col text-center ${unreleased ? 'opacity-60' : ''}`}
              title={subLabel ? `${c.name} — ${subLabel}` : undefined}
            >
              <ChampionPortrait
                name={c.name}
                klass={c.class}
                portraitUrl={c.portraitUrl ?? null}
                fill
                showClassOverlay={Boolean(c.portraitUrl)}
                rarity={rarity}
                hoverPop
              />
              <div className="mt-1 text-[11px] sm:text-sm font-medium leading-tight line-clamp-2">
                {c.name}
              </div>
              {subLabel ? (
                <div className="text-[10px] sm:text-xs text-[var(--color-ink-soft)] italic mt-0.5">
                  {subLabel}
                </div>
              ) : c.ascendable ? (
                <div className="text-[10px] sm:text-xs text-[var(--color-marvel-editorial)] font-medium mt-0.5">
                  ascendable
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="py-12 text-center text-[var(--color-ink-soft)] italic">
          No champions match the current filters.
        </div>
      )}
    </div>
  );
}
