'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  calculateBHR,
  computeCeilings,
  type Champion,
  type ChampionState,
  type Roster,
} from '@prestige-tools/engine';
import { loadRoster, saveRoster } from '../lib/roster-storage';
import { formatBHR, formatDelta } from '../lib/format';
import { RosterPicker } from './roster-picker';
import { BulkImport } from './bulk-import';
import { ChampionTickboxGrid } from './champion-tickbox-grid';
import { ScreenshotImport } from './screenshot-import';
import { ShareModal } from './share-modal';
import { ChampionPortrait } from './champion-portrait';
import { PortraitSeed } from './portrait-seed';

const FEATURE_SCREENSHOT_IMPORT = false;

type RosterManagerProps = {
  champions: Champion[];
};

type AddMode = 'picker' | 'tickbox' | 'screenshot' | 'bulk' | 'seed';

type SortColumn =
  | 'name'
  | 'class'
  | 'currentBHR'
  | 'ceilingBHR'
  | 'headroomBHR'
  | 'prestigeDeltaIfMaxed'
  | 'inTop30';
type SortDirection = 'asc' | 'desc';

/**
 * The orchestrator for the /roster page. Owns the roster state, persists it
 * to localStorage, and hosts the picker / bulk import / screenshot import /
 * roster table.
 *
 * Mount hydration: localStorage isn't readable on the server; we render an
 * empty roster server-side then load on mount. This causes a brief flash
 * between SSR and client hydration which is acceptable for a personal tool.
 */
export function RosterManager({ champions }: RosterManagerProps) {
  const [roster, setRoster] = useState<Roster>({ champions: [] });
  const [hydrated, setHydrated] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('picker');
  const [shareOpen, setShareOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('currentBHR');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(false);

  // Load on mount
  useEffect(() => {
    setRoster(loadRoster());
    setHydrated(true);
  }, []);

  // Persist on change (after hydration so we don't clobber on mount)
  useEffect(() => {
    if (!hydrated) return;
    saveRoster(roster);
  }, [roster, hydrated]);

  const championLookup = new Map(champions.map((c) => [c.id, c]));
  const ownedIds = new Set(roster.champions.map((s) => s.championId));

  // Filter out states referencing champions no longer in the seed (defensive
  // against schema evolution between sessions). Hidden silently — users
  // re-add if they want them back.
  const validRoster: Roster = {
    champions: roster.champions.filter((s) => championLookup.has(s.championId)),
  };

  function handleAdd(state: ChampionState) {
    setRoster((prev) => ({
      champions: [...prev.champions.filter((s) => s.championId !== state.championId), state],
    }));
  }

  function handleBulkImport(states: ChampionState[]) {
    setRoster((prev) => {
      // For each incoming state, replace any existing state for that champion
      const incomingIds = new Set(states.map((s) => s.championId));
      const kept = prev.champions.filter((s) => !incomingIds.has(s.championId));
      return { champions: [...kept, ...states] };
    });
  }

  function handleRemove(championId: string) {
    setRoster((prev) => ({
      champions: prev.champions.filter((s) => s.championId !== championId),
    }));
  }

  function handleClear() {
    if (window.confirm('Remove all champions from your roster?')) {
      setRoster({ champions: [] });
    }
  }

  const ceilings =
    validRoster.champions.length > 0
      ? computeCeilings(validRoster.champions, championLookup)
      : [];

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      const numericCols: SortColumn[] = [
        'currentBHR',
        'ceilingBHR',
        'headroomBHR',
        'prestigeDeltaIfMaxed',
        'inTop30',
      ];
      setSortDirection(numericCols.includes(column) ? 'desc' : 'asc');
    }
  }

  const sortedCeilings = [...ceilings].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'name':
        return a.championName.localeCompare(b.championName) * dir;
      case 'class':
        return a.championClass.localeCompare(b.championClass) * dir;
      case 'currentBHR':
        return (a.currentBHR - b.currentBHR) * dir;
      case 'ceilingBHR':
        return (a.ceilingBHR - b.ceilingBHR) * dir;
      case 'headroomBHR':
        return (a.headroomBHR - b.headroomBHR) * dir;
      case 'prestigeDeltaIfMaxed':
        return (a.prestigeDeltaIfMaxed - b.prestigeDeltaIfMaxed) * dir;
      case 'inTop30':
        return (Number(a.inTop30) - Number(b.inTop30)) * dir;
    }
  });

  const stateByChampion = new Map(
    validRoster.champions.map((s) => [s.championId, s]),
  );

  const unconfirmedCount = validRoster.champions.filter(
    (s) => s.stateConfirmed === false,
  ).length;

  const displayedCeilings = unconfirmedOnly
    ? sortedCeilings.filter(
        (e) => stateByChampion.get(e.championId)?.stateConfirmed === false,
      )
    : sortedCeilings;

  return (
    <div className="space-y-8">
      <section className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded-lg p-6 space-y-4">
        <div className="flex gap-1 bg-[var(--color-paper)] rounded-md p-1 border border-[var(--color-rule)] text-sm w-fit flex-wrap">
          <button
            type="button"
            onClick={() => setAddMode('picker')}
            className={`px-3 py-1 rounded transition-colors ${
              addMode === 'picker'
                ? 'bg-[var(--color-paper-soft)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Add one
          </button>
          <button
            type="button"
            onClick={() => setAddMode('tickbox')}
            className={`px-3 py-1 rounded transition-colors ${
              addMode === 'tickbox'
                ? 'bg-[var(--color-paper-soft)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Tick everyone you own
          </button>
          {FEATURE_SCREENSHOT_IMPORT && (
            <button
              type="button"
              onClick={() => setAddMode('screenshot')}
              className={`px-3 py-1 rounded transition-colors ${
                addMode === 'screenshot'
                  ? 'bg-[var(--color-paper-soft)] font-medium'
                  : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
              }`}
            >
              Screenshot import
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddMode('bulk')}
            className={`px-3 py-1 rounded transition-colors ${
              addMode === 'bulk'
                ? 'bg-[var(--color-paper-soft)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Bulk paste
          </button>
          <button
            type="button"
            onClick={() => setAddMode('seed')}
            className={`px-3 py-1 rounded transition-colors ${
              addMode === 'seed'
                ? 'bg-[var(--color-paper-soft)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Seed portraits
          </button>
        </div>

        {addMode === 'picker' && (
          <RosterPicker
            champions={champions}
            ownedIds={ownedIds}
            onAdd={handleAdd}
          />
        )}
        {addMode === 'tickbox' && (
          <ChampionTickboxGrid
            champions={champions}
            ownedIds={ownedIds}
            onAdd={handleBulkImport}
          />
        )}
        {FEATURE_SCREENSHOT_IMPORT && addMode === 'screenshot' && (
          <ScreenshotImport
            champions={champions}
            onImport={handleBulkImport}
          />
        )}
        {addMode === 'bulk' && (
          <BulkImport champions={champions} onImport={handleBulkImport} />
        )}
        {addMode === 'seed' && (
          <PortraitSeed
            champions={champions}
            onImport={handleBulkImport}
          />
        )}
      </section>

      {hydrated && roster.champions.length > 0 && (
        <>
          <section className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="editorial-heading text-xl">
              Your roster
              <span className="text-base font-normal text-[var(--color-ink-soft)] ml-2">
                ({roster.champions.length}{' '}
                {roster.champions.length === 1 ? 'champion' : 'champions'})
              </span>
            </h2>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="px-3 py-1.5 text-sm bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
              >
                Share roster
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline"
              >
                Clear all
              </button>
            </div>
          </section>

          {unconfirmedCount > 0 && (
            <section className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] px-4 py-3 flex items-center justify-between flex-wrap gap-2 text-sm">
              <span>
                <strong>{unconfirmedCount}</strong>{' '}
                {unconfirmedCount === 1 ? 'champion has an' : 'champions have an'}{' '}
                unconfirmed state — rank/sig estimated from a screenshot or not
                yet set. They&apos;re excluded from atomic-move recommendations
                until you confirm them.
              </span>
              <button
                type="button"
                onClick={() => setUnconfirmedOnly((v) => !v)}
                className="text-xs text-[var(--color-marvel-impact)] hover:underline font-medium whitespace-nowrap"
              >
                {unconfirmedOnly ? 'Show all' : `Review the ${unconfirmedCount} →`}
              </button>
            </section>
          )}

          <section className="overflow-x-auto border border-[var(--color-rule)] rounded">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-paper-soft)] border-b border-[var(--color-rule)]">
                <tr>
                  <SortableHeader
                    column="name"
                    label="Champion"
                    align="left"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="class"
                    label="Class"
                    align="left"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <th className="text-center p-3 font-medium">State</th>
                  <SortableHeader
                    column="currentBHR"
                    label="Current BHR"
                    align="right"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="ceilingBHR"
                    label="Ceiling"
                    align="right"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="headroomBHR"
                    label="Δ Headroom"
                    align="right"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="prestigeDeltaIfMaxed"
                    label="Δ Prestige if maxed"
                    align="right"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="inTop30"
                    label="In top 30"
                    align="center"
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <th className="w-px p-3"></th>
                </tr>
              </thead>
              <tbody>
                {displayedCeilings.map((entry) => {
                  const state = stateByChampion.get(entry.championId);
                  if (!state) return null;
                  const champion = championLookup.get(entry.championId);
                  const isUnconfirmed = state.stateConfirmed === false;
                  return (
                    <tr
                      key={entry.championId}
                      className={`border-t border-[var(--color-rule)] hover:bg-[var(--color-paper-soft)] ${
                        isUnconfirmed ? 'bg-[var(--color-paper-soft)]/40' : ''
                      }`}
                    >
                      <td className="p-2">
                        <Link
                          href={`/champions/${entry.championId}/`}
                          className="flex items-center gap-3 hover:text-[var(--color-marvel-impact)] transition-colors"
                        >
                          {champion && (
                            <div className="flex-shrink-0">
                              <ChampionPortrait
                                name={entry.championName}
                                klass={entry.championClass}
                                portraitUrl={champion.portraitUrl ?? null}
                                size={36}
                              />
                            </div>
                          )}
                          <span>{entry.championName}</span>
                        </Link>
                      </td>
                      <td className="p-3 text-[var(--color-ink-soft)]">
                        {entry.championClass}
                      </td>
                      <td className="p-3 text-center text-xs numeric">
                        {isUnconfirmed ? (
                          <span
                            className="text-[var(--color-ink-soft)] italic"
                            title="Estimated from screenshot BHR — confirm to include in atomic-move recommendations"
                          >
                            R{state.rank} sig {state.sig} {state.ascension}
                            <span className="not-italic text-[10px]"> · est</span>
                          </span>
                        ) : (
                          <>
                            R{state.rank} sig {state.sig} {state.ascension}
                          </>
                        )}
                      </td>
                      <td className="p-3 text-right numeric">
                        {formatBHR(entry.currentBHR)}
                      </td>
                      <td className="p-3 text-right numeric">
                        {formatBHR(entry.ceilingBHR)}
                      </td>
                      <td className="p-3 text-right numeric">
                        {entry.headroomBHR === 0
                          ? '—'
                          : formatBHR(entry.headroomBHR)}
                      </td>
                      <td
                        className={`p-3 text-right numeric ${
                          entry.prestigeDeltaIfMaxed > 0
                            ? 'text-[var(--color-marvel-editorial)] font-medium'
                            : 'text-[var(--color-ink-soft)]'
                        }`}
                      >
                        {entry.prestigeDeltaIfMaxed > 0
                          ? formatDelta(entry.prestigeDeltaIfMaxed)
                          : '—'}
                      </td>
                      <td className="p-3 text-center">
                        {entry.inTop30 ? '✓' : ''}
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => handleRemove(entry.championId)}
                          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)]"
                          aria-label={`Remove ${entry.championName}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <RosterSummary roster={validRoster} championLookup={championLookup} />
        </>
      )}

      {hydrated && roster.champions.length === 0 && (
        <section className="text-center py-12 text-[var(--color-ink-soft)]">
          <p>
            Add champions above to see your roster, recommendations, and
            ceiling analysis.
          </p>
        </section>
      )}

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        roster={validRoster.champions}
      />
    </div>
  );
}

/**
 * Summary stats: current top-30 prestige, cutoff BHR.
 */
function RosterSummary({
  roster,
  championLookup,
}: {
  roster: Roster;
  championLookup: Map<string, Champion>;
}) {
  if (roster.champions.length === 0) return null;

  const bhrs = roster.champions.map((s) => {
    const c = championLookup.get(s.championId)!;
    return calculateBHR(c, s);
  });
  const sorted = [...bhrs].sort((a, b) => b - a);
  const top30 = sorted.slice(0, 30);
  const prestige = Math.floor(top30.reduce((a, b) => a + b, 0) / top30.length);
  const cutoff = top30.length === 30 ? top30[29]! : 0;

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Stat label="Champions in roster" value={roster.champions.length.toString()} />
      <Stat
        label="Top-30 prestige"
        value={top30.length === 30 ? formatBHR(prestige) : '—'}
        note={top30.length < 30 ? `${30 - top30.length} more needed` : undefined}
      />
      <Stat
        label="Cutoff BHR"
        value={cutoff > 0 ? formatBHR(cutoff) : '—'}
        note={cutoff > 0 ? 'rank #30' : undefined}
      />
      <Stat
        label="Highest BHR"
        value={top30.length > 0 ? formatBHR(top30[0]!) : '—'}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
        {label}
      </div>
      <div className="numeric text-2xl font-medium mt-1">{value}</div>
      {note && (
        <div className="text-xs text-[var(--color-ink-soft)] mt-1">{note}</div>
      )}
    </div>
  );
}

function SortableHeader({
  column,
  label,
  align,
  sortColumn,
  sortDirection,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align: 'left' | 'right' | 'center';
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  const active = sortColumn === column;
  const arrow = active ? (sortDirection === 'asc' ? '↑' : '↓') : '';
  const alignCls =
    align === 'left'
      ? 'text-left'
      : align === 'right'
        ? 'text-right'
        : 'text-center';
  return (
    <th className={`${alignCls} p-3 font-medium`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`hover:text-[var(--color-marvel-impact)] transition-colors ${
          active ? 'text-[var(--color-marvel-editorial)]' : ''
        }`}
      >
        {label}
        {arrow && <span className="ml-1 numeric">{arrow}</span>}
      </button>
    </th>
  );
}
