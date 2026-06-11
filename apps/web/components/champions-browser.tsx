'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Champion, ChampionClass } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';
import { ClassIcon, classColors } from './class-icon';

type ChampionsBrowserProps = {
  champions: Champion[];
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

/**
 * Browseable champion grid with class filter chips and ascendable toggle.
 * Sorts alphabetically by default.
 */
export function ChampionsBrowser({ champions }: ChampionsBrowserProps) {
  const [activeClasses, setActiveClasses] = useState<Set<ChampionClass>>(
    new Set(ALL_CLASSES),
  );
  const [ascendableFilter, setAscendableFilter] = useState<AscendableFilter>('all');

  const filtered = useMemo(() => {
    return champions
      .filter((c) => activeClasses.has(c.class))
      .filter((c) => {
        if (ascendableFilter === 'all') return true;
        if (ascendableFilter === 'ascendable') return c.ascendable;
        return !c.ascendable;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [champions, activeClasses, ascendableFilter]);

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
      </div>

      <div className="text-sm text-[var(--color-ink-soft)]">
        Showing {filtered.length} of {champions.length} champions
      </div>

      {/* Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-1.5">
        {filtered.map((c) => {
          const unreleased = c.sevenStarReleased === false;
          return (
            <Link
              key={c.id}
              href={`/champions/${c.id}/`}
              className={`border border-[var(--color-rule)] rounded-lg p-1.5 bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)] transition-colors flex flex-col text-center ${unreleased ? 'opacity-60' : ''}`}
              title={unreleased ? `${c.name} — not yet released at 7-star` : undefined}
            >
              <ChampionPortrait
                name={c.name}
                klass={c.class}
                portraitUrl={c.portraitUrl ?? null}
                fill
                showClassOverlay={Boolean(c.portraitUrl)}
                rarity={unreleased ? 'unreleased' : '7-star'}
              />
              <div className="mt-1 text-[11px] sm:text-sm font-medium leading-tight line-clamp-2">
                {c.name}
              </div>
              {unreleased ? (
                <div className="text-[10px] sm:text-xs text-[var(--color-ink-soft)] italic mt-0.5">
                  Not yet 7★
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
