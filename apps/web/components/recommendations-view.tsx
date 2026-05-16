'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  applyMove,
  computeCeilings,
  optimise,
  type Champion,
  type ChampionState,
  type Roster,
  type ScoredMove,
  type CeilingEntry,
} from '@prestige-tools/engine';
import { loadRoster, saveRoster } from '../lib/roster-storage';
import { formatBHR, formatDelta } from '../lib/format';
import { ChampionPortrait } from './champion-portrait';
import { AddToRosterModal } from './add-to-roster-modal';

type RecommendationsViewProps = {
  champions: Champion[];
};

type Mode = 'atomic' | 'ceiling';

type Toast = {
  message: string;
  prevRoster: Roster;
};

export function RecommendationsView({ champions }: RecommendationsViewProps) {
  const [roster, setRoster] = useState<Roster>({ champions: [] });
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>('atomic');
  const [toast, setToast] = useState<Toast | null>(null);
  const [addingChampion, setAddingChampion] = useState<Champion | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRoster(loadRoster());
    setHydrated(true);
  }, []);

  // Don't render computed data until we've hydrated from localStorage
  if (!hydrated) {
    return (
      <div className="py-12 text-center text-[var(--color-ink-soft)]">Loading roster…</div>
    );
  }

  if (roster.champions.length === 0) {
    return (
      <section className="bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded-lg p-8 text-center">
        <p className="text-[var(--color-ink-soft)] mb-4">
          You haven&apos;t added any champions yet.
        </p>
        <Link
          href="/roster/"
          className="inline-block bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium px-6 py-3 rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
        >
          Set up your roster →
        </Link>
      </section>
    );
  }

  const championLookup = new Map(champions.map((c) => [c.id, c]));
  // Defensive: drop states referencing champions not in the current seed
  const validStates = roster.champions.filter((s) => championLookup.has(s.championId));
  const moves = optimise(validStates, championLookup, 12);
  // Long-term plan includes ALL active champions, not just owned — answers
  // "what would maxing any champion do for my prestige" including pulls
  // you'd want to prioritise. Unowned entries marked owned: false.
  // The UI splits into "worth developing" (owned) + "worth pulling" (unowned)
  // sections with 6 entries each, so we feed it the full ranked list.
  const ceilings = computeCeilings(validStates, championLookup, champions);

  function handleMoveDone(move: ScoredMove) {
    // Capture previous state for undo, apply move, persist, schedule auto-dismiss
    const prevRoster = roster;
    const newChampions = applyMove(roster.champions, move.move);
    const newRoster: Roster = { champions: newChampions };
    setRoster(newRoster);
    saveRoster(newRoster);

    const description = describeMove(move);
    setToast({
      message: `${move.championName}: ${description} — done.`,
      prevRoster,
    });

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 6000);
  }

  function handleUndo() {
    if (!toast) return;
    setRoster(toast.prevRoster);
    saveRoster(toast.prevRoster);
    setToast(null);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
  }

  function handleAddToRoster(state: ChampionState) {
    // Add the champion with the chosen state. Recommendations recompute on
    // next render — the new champion may immediately appear in Short-term plan
    // as a development target.
    const champion = championLookup.get(state.championId);
    const championName = champion?.name ?? state.championId;
    const newRoster: Roster = {
      champions: [...roster.champions, state],
    };
    setRoster(newRoster);
    saveRoster(newRoster);
    setAddingChampion(null);
    // Toast with undo — same pattern as marking moves done
    setToast({
      message: `Added ${championName} (R${state.rank} sig ${state.sig} ${state.ascension}). Undo?`,
      prevRoster: roster,
    });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 6000);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-3">
        <h2 className="editorial-heading text-2xl">
          {mode === 'atomic' ? 'Short-term plan' : 'Long-term plan'}
        </h2>
        <div className="flex gap-1 bg-[var(--color-paper-soft)] rounded-md p-1 border border-[var(--color-rule)] text-sm">
          <button
            type="button"
            onClick={() => setMode('atomic')}
            className={`px-3 py-1 rounded transition-colors ${
              mode === 'atomic'
                ? 'bg-[var(--color-paper)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Short-term plan
          </button>
          <button
            type="button"
            onClick={() => setMode('ceiling')}
            className={`px-3 py-1 rounded transition-colors ${
              mode === 'ceiling'
                ? 'bg-[var(--color-paper)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Long-term plan
          </button>
        </div>
      </div>

      {mode === 'atomic' ? (
        <AtomicMovesList
          moves={moves}
          championLookup={championLookup}
          onMoveDone={handleMoveDone}
        />
      ) : (
        <CeilingList
          key={`ceiling-${validStates.length}`}
          entries={ceilings}
          championLookup={championLookup}
          onAddToRoster={(champion) => setAddingChampion(champion)}
        />
      )}

      <p className="text-sm text-[var(--color-ink-soft)] pt-4 border-t border-[var(--color-rule)]">
        <Link href="/about/" className="underline hover:text-[var(--color-marvel-impact)]">
          Read the working →
        </Link>
        {' — '}
        how the math works, what cost gates mean, why the deferral logic surfaces some moves lower.
      </p>

      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-ink)] text-[var(--color-paper)] px-4 py-3 rounded shadow-lg flex items-center gap-4 max-w-md"
          role="status"
        >
          <span className="text-sm">{toast.message}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-medium text-[var(--color-burst-yellow)] underline hover:no-underline"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[var(--color-ink-soft)] hover:text-[var(--color-paper)]"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <AddToRosterModal
        champion={addingChampion}
        onAdd={handleAddToRoster}
        onClose={() => setAddingChampion(null)}
      />
    </div>
  );
}

function AtomicMovesList({
  moves,
  championLookup,
  onMoveDone,
}: {
  moves: ScoredMove[];
  championLookup: Map<string, Champion>;
  onMoveDone: (move: ScoredMove) => void;
}) {
  if (moves.length === 0) {
    return (
      <p className="text-[var(--color-ink-soft)] italic">
        No moves available. Your roster might be fully developed, or you may need
        to add more champions to enable rank-up enumeration.
      </p>
    );
  }

  // Partition moves: regular (proceed) vs. deferred (ascend-first)
  const proceedMoves = moves.filter((m) => !m.deferRecommendation);
  const deferredMoves = moves.filter((m) => m.deferRecommendation === 'ascend-first');

  return (
    <div className="space-y-8">
      <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0">
        {proceedMoves.map((move, idx) => (
          <li key={`${move.move.championId}-${move.move.kind}`}>
            <MoveCard
              move={move}
              rank={idx + 1}
              champion={championLookup.get(move.move.championId)}
              onDone={() => onMoveDone(move)}
            />
          </li>
        ))}
      </ol>

      {deferredMoves.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-[var(--color-rule)]">
          <h3 className="editorial-heading text-lg text-[var(--color-ink-soft)]">
            Deferred — ascend first
          </h3>
          <p className="text-sm text-[var(--color-ink-soft)]">
            These rank-up moves are available, but you&apos;d capture more
            prestige by ascending the champion first (A0 → A1 → A2), then ranking
            up. Not wrong to do them now if you&apos;ve given up on the
            ascension pulls — just suboptimal sequencing.
          </p>
          <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0">
            {deferredMoves.map((move) => (
              <li key={`${move.move.championId}-${move.move.kind}`}>
                <MoveCard
                  move={move}
                  rank={null}
                  champion={championLookup.get(move.move.championId)}
                  onDone={() => onMoveDone(move)}
                  dimmed
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function MoveCard({
  move,
  rank,
  champion,
  onDone,
  dimmed,
}: {
  move: ScoredMove;
  rank: number | null;
  champion: Champion | undefined;
  onDone?: () => void;
  dimmed?: boolean;
}) {
  const moveDescription = describeMove(move);
  const isTop = rank === 1;

  return (
    <div
      className={`border rounded-lg p-3 transition-colors h-full flex flex-col ${
        dimmed
          ? 'border-[var(--color-rule)] bg-[var(--color-paper-card)] opacity-75'
          : isTop
            ? 'border-[var(--color-marvel-impact)] bg-[var(--color-paper-card)] shadow-sm hover:bg-[var(--color-paper-soft)]'
            : 'border-[var(--color-rule)] bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)]'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Left column: portrait + move description (R4 → R5).
            Keeping rank-info under the portrait makes the left column a
            fixed-content unit so a wrapping champion name on the right
            doesn't desync the visual rhythm row-to-row. */}
        {champion && (
          <div className="flex-shrink-0 flex flex-col items-center">
            <Link
              href={`/champions/${champion.id}/`}
              aria-label={`Open ${champion.name} detail page`}
            >
              <ChampionPortrait
                name={champion.name}
                klass={champion.class}
                portraitUrl={champion.portraitUrl ?? null}
                size={64}
                showClassOverlay={Boolean(champion.portraitUrl)}
              />
            </Link>
            <div className="text-xs text-[var(--color-ink-soft)] numeric mt-1 text-center">
              {moveDescription}
            </div>
          </div>
        )}

        {/* Middle: rank number + name (can wrap freely). */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {rank !== null && (
              <span className="text-lg font-medium text-[var(--color-ink-soft)] numeric flex-shrink-0">
                {rank}.
              </span>
            )}
            <div
              className="font-medium leading-tight truncate"
              title={move.championName}
            >
              {move.championName}
            </div>
          </div>
        </div>

        {/* Right: prestige delta + BHR */}
        <div className="text-right flex-shrink-0">
          <div
            className={`numeric font-medium text-lg ${
              isTop ? 'burst text-2xl' : 'text-[var(--color-marvel-editorial)]'
            }`}
          >
            {formatDelta(move.top30Delta)}
          </div>
          <div className="text-xs text-[var(--color-ink-soft)] numeric">
            BHR {formatBHR(move.beforeBHR)} → {formatBHR(move.afterBHR)}
          </div>
        </div>
      </div>

      {/* Cost gates */}
      {(move.costGates.length > 0 || onDone) && (
        <div className="mt-auto pt-3 border-t border-[var(--color-rule)] flex flex-wrap items-center gap-2">
          {move.costGates.map((gate, i) => (
            <span
              key={i}
              className={`text-xs px-2 py-1 rounded numeric ${costGateBadge(gate.kind)}`}
            >
              {gate.label}
            </span>
          ))}
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="ml-auto text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] hover:border-[var(--color-marvel-editorial)] transition-colors"
            >
              ✓ I&apos;ve done this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CeilingList({
  entries,
  championLookup,
  onAddToRoster,
}: {
  entries: CeilingEntry[];
  championLookup: Map<string, Champion>;
  onAddToRoster: (champion: Champion) => void;
}) {
  // Split into two arenas: champions in your roster you should develop, and
  // unowned champions worth pulling for. Each capped at 6 entries — total 12,
  // matching the previous combined cap. Each sorted by impact within scope.
  const owned = entries
    .filter((e) => e.owned && e.prestigeDeltaIfMaxed > 0)
    .slice(0, 6);
  const unowned = entries
    .filter((e) => !e.owned && e.prestigeDeltaIfMaxed > 0)
    .slice(0, 6);

  if (owned.length === 0 && unowned.length === 0) {
    return (
      <p className="text-[var(--color-ink-soft)] italic">
        No ceiling moves available. Try adding more champions to your roster.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {owned.length > 0 && (
        <section className="space-y-3">
          <h3 className="editorial-heading text-xl">
            In your roster — worth developing
          </h3>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Owned champions ranked by the prestige gain if you took them to
            their full ceiling (R5 sig 200, max ascension if eligible).
          </p>
          <CeilingGrid entries={owned} championLookup={championLookup} startIndex={0} />
        </section>
      )}

      {unowned.length > 0 && (
        <section className="space-y-3">
          <h3 className="editorial-heading text-xl">Worth pulling</h3>
          <p className="text-sm text-[var(--color-ink-soft)]">
            Champions not in your roster whose ceilings would displace your
            current rank-30 if acquired and developed. Use as a pull-priority
            shortlist for featured, Titan, and sale crystals. Already own one?
            Click <em>I have this</em> to add them in seconds.
          </p>
          <CeilingGrid
            entries={unowned}
            championLookup={championLookup}
            startIndex={0}
            onAddToRoster={onAddToRoster}
          />
        </section>
      )}
    </div>
  );
}

function CeilingGrid({
  entries,
  championLookup,
  startIndex,
  onAddToRoster,
}: {
  entries: CeilingEntry[];
  championLookup: Map<string, Champion>;
  startIndex: number;
  onAddToRoster?: (champion: Champion) => void;
}) {
  return (
    <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0">
      {entries.map((entry, idx) => {
        const champion = championLookup.get(entry.championId);
        const displayIndex = startIndex + idx;
        const isTop = displayIndex === 0;
        return (
          <li
            key={entry.championId}
            className={`border rounded-lg p-3 transition-colors h-full flex flex-col ${
              !entry.owned
                ? 'border-[var(--color-rule)] bg-[var(--color-paper-card)] opacity-60 hover:opacity-100 hover:bg-[var(--color-paper-soft)]'
                : isTop
                  ? 'border-[var(--color-marvel-impact)] bg-[var(--color-paper-card)] shadow-sm hover:bg-[var(--color-paper-soft)]'
                  : 'border-[var(--color-rule)] bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)]'
            }`}
          >
            <div className="flex items-start gap-3">
              {champion && (
                <Link
                  href={`/champions/${champion.id}/`}
                  className="flex-shrink-0"
                  aria-label={`Open ${champion.name} detail page`}
                >
                  <ChampionPortrait
                    name={champion.name}
                    klass={champion.class}
                    portraitUrl={champion.portraitUrl ?? null}
                    size={64}
                    showClassOverlay={Boolean(champion.portraitUrl)}
                  />
                </Link>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-medium text-[var(--color-ink-soft)] numeric flex-shrink-0">
                    {displayIndex + 1}.
                  </span>
                  <div
                    className="font-medium leading-tight truncate"
                    title={entry.championName}
                  >
                    {entry.championName}
                  </div>
                </div>
                <div className="text-sm text-[var(--color-ink-soft)] mt-0.5">
                  {!entry.owned
                    ? 'Not in roster — would displace cutoff if pulled & maxed'
                    : entry.inTop30
                      ? 'In top-30 — improve'
                      : 'Outside top-30 — displace cutoff'}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div
                  className={`numeric font-medium ${
                    isTop && entry.owned
                      ? 'burst text-2xl'
                      : 'text-[var(--color-marvel-editorial)] text-lg'
                  }`}
                >
                  {formatDelta(entry.prestigeDeltaIfMaxed)}
                </div>
                <div className="text-xs text-[var(--color-ink-soft)] numeric">
                  {entry.owned
                    ? `BHR ${formatBHR(entry.currentBHR)} → ${formatBHR(entry.ceilingBHR)}`
                    : `Ceiling BHR ${formatBHR(entry.ceilingBHR)}`}
                </div>
              </div>
            </div>

            {entry.totalCostGates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-auto pt-3 border-t border-[var(--color-rule)]">
                {entry.totalCostGates.map((gate, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-1 rounded numeric ${costGateBadge(gate.kind)}`}
                  >
                    {gate.label}
                  </span>
                ))}
              </div>
            )}

            {/* "I have this" button on unowned cards — quick-adds to roster. */}
            {!entry.owned && onAddToRoster && champion && (
              <div className="mt-auto pt-3 border-t border-[var(--color-rule)] flex justify-end">
                <button
                  type="button"
                  onClick={() => onAddToRoster(champion)}
                  className="text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] hover:border-[var(--color-marvel-editorial)] transition-colors"
                >
                  + I have this
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function describeMove(move: ScoredMove): string {
  switch (move.move.kind) {
    case 'rank-up':
      return `R${move.move.fromRank} → R${move.move.toRank}`;
    case 'sig-up':
      return `Sig ${move.move.fromSig} → ${move.move.toSig}`;
    case 'ascend':
      return `${move.move.fromAscension} → ${move.move.toAscension}`;
  }
}

function costGateBadge(kind: 'rank-cats' | 'sig-stones' | 'ascension'): string {
  switch (kind) {
    case 'rank-cats':
      return 'bg-[var(--color-paper-soft)] border border-[var(--color-rule)]';
    case 'sig-stones':
      return 'bg-blue-50 border border-blue-200 text-blue-900';
    case 'ascension':
      return 'bg-amber-50 border border-amber-300 text-amber-900';
  }
}
