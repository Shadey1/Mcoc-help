'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  computeCeilings,
  type Champion,
  type ChampionState,
  type Roster,
} from '@prestige-tools/engine';
import { loadRoster, saveRoster } from '../lib/roster-storage';
import { formatBHR, formatDelta } from '../lib/format';
import { useBHROverrides } from '../lib/bhr-overrides-context';
import { RosterPicker } from './roster-picker';
import { BulkImport } from './bulk-import';
import { ChampionTickboxGrid } from './champion-tickbox-grid';
import { ScreenshotImport } from './screenshot-import';
import { ShareModal } from './share-modal';
import { ChampionPortrait } from './champion-portrait';
import { PortraitSeed } from './portrait-seed';
import { RosterSummary } from './roster-summary';
import { BhrCell } from './bhr-cell';

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
  const [editingChampionId, setEditingChampionId] = useState<string | null>(null);
  const rosterSectionRef = useRef<HTMLElement | null>(null);
  const { overrides } = useBHROverrides();
  // Champion IDs to pulse-highlight for 3s after an inline edit, so the
  // user can track the row as the table re-sorts to its new position.
  const [recentlyEditedIds, setRecentlyEditedIds] = useState<Set<string>>(new Set());

  function markRecentlyEdited(championId: string) {
    setRecentlyEditedIds((prev) => new Set(prev).add(championId));
    setTimeout(() => {
      setRecentlyEditedIds((prev) => {
        const next = new Set(prev);
        next.delete(championId);
        return next;
      });
    }, 3000);
  }

  /** Smooth-scrolls to the roster table — used after bulk imports so the user
   *  sees what just landed instead of staring at the import surface. */
  function scrollToRoster() {
    // Wait one frame for the table to render before scrolling, otherwise we
    // scroll to the section's pre-mount position.
    requestAnimationFrame(() => {
      rosterSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

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
    scrollToRoster();
  }

  function handleRemove(championId: string) {
    setRoster((prev) => ({
      champions: prev.champions.filter((s) => s.championId !== championId),
    }));
  }

  /**
   * Fast-path for "the estimate was correct" — flips stateConfirmed:true on a
   * single entry without touching its rank/sig/ascension. Avoids forcing the
   * user through the edit form just to acknowledge a screenshot-imported state.
   */
  function handleConfirmState(championId: string) {
    setRoster((prev) => ({
      champions: prev.champions.map((s) =>
        s.championId === championId ? { ...s, stateConfirmed: true } : s,
      ),
    }));
    markRecentlyEdited(championId);
  }

  /**
   * In-roster state edit (rank/sig/ascension). Saves a confirmed state — the
   * act of explicit editing is the user's confirmation, so an estimated entry
   * becomes confirmed once edited even if values match the prior estimate.
   */
  function handleEditState(
    championId: string,
    next: { rank: 3 | 4 | 5; sig: number; ascension: 'A0' | 'A1' | 'A2' },
  ) {
    setRoster((prev) => ({
      champions: prev.champions.map((s) =>
        s.championId === championId
          ? { ...s, ...next, stateConfirmed: true }
          : s,
      ),
    }));
    setEditingChampionId(null);
    markRecentlyEdited(championId);
  }

  function handleClear() {
    if (window.confirm('Remove all champions from your roster?')) {
      setRoster({ champions: [] });
    }
  }

  const ceilings =
    validRoster.champions.length > 0
      ? computeCeilings(validRoster.champions, championLookup, undefined, overrides)
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
            Upload roster
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
          <section
            ref={rosterSectionRef}
            className="flex items-center justify-between flex-wrap gap-3 scroll-mt-4"
          >
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
                yet set. In the State column, tick <strong>✓</strong> if the
                estimate is correct, <strong>Edit</strong> to adjust, or
                <strong> ✗</strong> to remove. Unconfirmed champions are
                excluded from atomic-move recommendations.
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
                      } ${
                        recentlyEditedIds.has(entry.championId)
                          ? 'recently-edited'
                          : ''
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
                        <StateCell
                          state={state}
                          champion={champion}
                          isEditing={editingChampionId === entry.championId}
                          onStartEdit={() =>
                            setEditingChampionId(entry.championId)
                          }
                          onCancel={() => setEditingChampionId(null)}
                          onSave={(next) =>
                            handleEditState(entry.championId, next)
                          }
                          onConfirm={() =>
                            handleConfirmState(entry.championId)
                          }
                          onRemove={() => handleRemove(entry.championId)}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <BhrCell
                          champion={champion}
                          state={state}
                          displayedBhr={entry.currentBHR}
                        />
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
 * Display + inline editor for a champion's rank/sig/ascension.
 *
 * Closed: a button showing "R4 sig 200 A1" — click to edit. Estimated entries
 *   render in italic with a "· est" suffix; once saved they become confirmed.
 * Open:  three compact controls (rank select, sig number, ascension select)
 *   + Save/Cancel. Sig is a free-form 0-200 number — players end up with
 *   off-step values (e.g. sig 47 from a single sig stone) and editing those
 *   without removing/re-adding is the whole point of this surface.
 */
function StateCell({
  state,
  champion,
  isEditing,
  onStartEdit,
  onCancel,
  onSave,
  onConfirm,
  onRemove,
}: {
  state: ChampionState;
  champion: Champion | undefined;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (next: { rank: 3 | 4 | 5; sig: number; ascension: 'A0' | 'A1' | 'A2' }) => void;
  /** Fast-path confirm for screenshot-estimated states: keeps values, flips
   *  stateConfirmed:true. Only shown when the state is currently unconfirmed. */
  onConfirm: () => void;
  /** Remove this champion from the roster entirely. Surfaced inside the
   *  unconfirmed-state UI so misidentified screenshot imports can be evicted
   *  in one click without scrolling to the row's right-edge × button. */
  onRemove: () => void;
}) {
  // Engine emits Rank as 1|2|3|4|5 but v1 only supports R3-R5 — calculateBHR
  // throws on R1/R2. Narrow at the read site (runtime values are guaranteed in
  // range) so the editor's setState typing stays clean.
  const [rank, setRank] = useState<3 | 4 | 5>(state.rank as 3 | 4 | 5);
  const [sig, setSig] = useState<number>(state.sig);
  const [ascension, setAscension] = useState<'A0' | 'A1' | 'A2'>(state.ascension);

  // When the edit mode opens, sync from current state. (User may have changed
  // selectors then cancelled previously — start fresh from canonical state.)
  useEffect(() => {
    if (isEditing) {
      setRank(state.rank as 3 | 4 | 5);
      setSig(state.sig);
      setAscension(state.ascension);
    }
  }, [isEditing, state.rank, state.sig, state.ascension]);

  if (!isEditing) {
    const isUnconfirmed = state.stateConfirmed === false;
    if (isUnconfirmed) {
      // Unconfirmed states get an explicit three-action row: ✓ accepts the
      // estimate as-is, Edit opens the inline editor, ✗ removes the champion
      // entirely (one-click eviction for misidentified screenshot imports).
      return (
        <div className="flex items-center justify-center gap-1.5">
          <span
            className="text-[var(--color-ink-soft)] italic"
            title="Estimated from screenshot BHR"
          >
            R{state.rank} sig {state.sig} {state.ascension}
            <span className="not-italic text-[10px]"> · est</span>
          </span>
          <button
            type="button"
            onClick={onConfirm}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--color-rule)] hover:bg-[var(--color-marvel-impact)] hover:text-[var(--color-paper)] hover:border-[var(--color-marvel-impact)] transition-colors"
            title="Confirm this state is correct (no changes)"
            aria-label="Confirm state as-is"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={onStartEdit}
            className="px-1.5 py-0.5 text-[11px] rounded border border-[var(--color-rule)] hover:bg-[var(--color-paper-soft)] transition-colors"
            title="Edit rank, sig, or ascension"
            aria-label="Edit state"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-1.5 py-0.5 text-xs rounded border border-[var(--color-rule)] hover:bg-[var(--color-marvel-impact)] hover:text-[var(--color-paper)] hover:border-[var(--color-marvel-impact)] transition-colors"
            title="Remove this champion from your roster"
            aria-label="Remove champion"
          >
            ✗
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={onStartEdit}
        className="inline-block hover:text-[var(--color-marvel-impact)] transition-colors underline decoration-dotted decoration-[var(--color-rule)] underline-offset-2"
        title="Click to edit rank, sig, or ascension"
      >
        R{state.rank} sig {state.sig} {state.ascension}
      </button>
    );
  }

  const ascendable = champion?.ascendable ?? false;
  // Coerce ascension if champion isn't ascendable (matches add-flow behaviour)
  const effectiveAscension = ascendable ? ascension : 'A0';
  const clampedSig = Math.max(0, Math.min(200, Number.isFinite(sig) ? sig : 0));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1 text-xs">
        <select
          value={rank}
          onChange={(e) => setRank(Number(e.target.value) as 3 | 4 | 5)}
          className="px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)] text-xs"
          aria-label="Rank"
        >
          <option value={5}>R5</option>
          <option value={4}>R4</option>
          <option value={3}>R3</option>
        </select>
        <input
          type="number"
          min={0}
          max={200}
          step={1}
          value={sig}
          onChange={(e) => setSig(Number(e.target.value))}
          className="w-14 px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)] text-xs numeric"
          aria-label="Sig"
        />
        <select
          value={effectiveAscension}
          onChange={(e) => setAscension(e.target.value as 'A0' | 'A1' | 'A2')}
          disabled={!ascendable}
          className="px-1 py-0.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper)] text-xs disabled:opacity-50"
          aria-label="Ascension"
          title={ascendable ? undefined : "Champion isn't ascendable — locked at A0"}
        >
          <option value="A0">A0</option>
          {ascendable && (
            <>
              <option value="A1">A1</option>
              <option value="A2">A2</option>
            </>
          )}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSave({ rank, sig: clampedSig, ascension: effectiveAscension })}
          className="px-2 py-0.5 text-[11px] bg-[var(--color-marvel-impact)] text-[var(--color-paper)] rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-0.5 text-[11px] border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
        >
          Cancel
        </button>
      </div>
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
