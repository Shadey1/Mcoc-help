'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  applyMove,
  computeCeilings,
  enumerateRelicMoves,
  optimise,
  planSteps,
  type Champion,
  type ChampionState,
  type Roster,
  type ScoredMove,
  type ScoredRelicMove,
  type CeilingEntry,
  type PlanStep,
  type SpecialRelicId,
} from '@prestige-tools/engine';
import { loadRoster, saveRoster } from '../lib/roster-storage';
import { loadRelics, type RelicStateBundle } from '../lib/relics-storage';
import { formatBHR, formatDelta } from '../lib/format';
import { useBHROverrides } from '../lib/bhr-overrides-context';
import { useRelicOverrides } from '../lib/relic-overrides-context';
import { trackEvent } from '../lib/analytics';
import { ChampionPortrait } from './champion-portrait';
import { AddToRosterModal } from './add-to-roster-modal';
import { RosterSummary } from './roster-summary';

type RecommendationsViewProps = {
  champions: Champion[];
};

type Mode = 'atomic' | 'plan' | 'ceiling';

type Toast = {
  message: string;
  prevRoster: Roster;
};

// Discriminated union representing a single ranked atomic move — either a
// champion move (rank-up / sig-up / ascend) or a relic move (level-up /
// rank-up of relics). Carries a unified `top30Delta` field that lets the
// renderer sort heterogeneous moves on one axis: change in total prestige.
type InterleavedAtomicMove =
  | { kind: 'champion'; data: ScoredMove; top30Delta: number }
  | { kind: 'relic'; data: ScoredRelicMove; top30Delta: number };

export function RecommendationsView({ champions }: RecommendationsViewProps) {
  const [roster, setRoster] = useState<Roster>({ champions: [] });
  const [relicBundle, setRelicBundle] = useState<RelicStateBundle | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>('atomic');
  const [toast, setToast] = useState<Toast | null>(null);
  const [addingChampion, setAddingChampion] = useState<Champion | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { overrides } = useBHROverrides();
  const relicOverridesCtx = useRelicOverrides();
  const relicEngineOverrides = useMemo(
    () => ({
      statcast6: (
        rank: Parameters<typeof relicOverridesCtx.getStatcast6>[0],
        sig: Parameters<typeof relicOverridesCtx.getStatcast6>[1],
      ) => relicOverridesCtx.getStatcast6(rank, sig),
      battlecast6: (
        id: string,
        rank: Parameters<typeof relicOverridesCtx.getBattlecast6>[1],
        sig: Parameters<typeof relicOverridesCtx.getBattlecast6>[2],
      ) => relicOverridesCtx.getBattlecast6(id, rank, sig),
    }),
    [relicOverridesCtx],
  );

  useEffect(() => {
    setRoster(loadRoster());
    setRelicBundle(loadRelics());
    setHydrated(true);
  }, []);

  // Fire `recommendation_viewed` once per mount, when the value moment
  // actually displays (hydrated, non-empty roster, real recommendations
  // about to render). Guarded by a ref so it doesn't refire on re-renders.
  const recordedViewRef = useRef(false);
  useEffect(() => {
    if (
      hydrated &&
      roster.champions.length > 0 &&
      !recordedViewRef.current
    ) {
      recordedViewRef.current = true;
      trackEvent('recommendation_viewed');
    }
  }, [hydrated, roster.champions.length]);

  // Compute relic moves unconditionally (hook must run on every render,
  // regardless of whether bundle has loaded or roster is empty). Falls back
  // to empty array while bundle is null. Returns ScoredRelicMove[] which the
  // AtomicMovesList then converts to InterleavedAtomicMove.
  const relicMoves = useMemo(() => {
    if (!relicBundle) return [];
    return enumerateRelicMoves(
      relicBundle.inventory,
      relicBundle.top30Cutoff,
      relicEngineOverrides,
    );
  }, [relicBundle, relicEngineOverrides]);
  const relicCutoff = relicBundle?.top30Cutoff ?? 0;

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
  const moves = optimise(validStates, championLookup, 12, overrides);
  // Multi-step plan: 10 greedy moves with cumulative delta. Computed
  // lazily — only when the user switches to the Plan tab.
  const plan: PlanStep[] =
    mode === 'plan' ? planSteps(validStates, championLookup, 10, overrides) : [];
  // Long-term plan includes ALL active champions, not just owned — answers
  // "what would maxing any champion do for my prestige" including pulls
  // you'd want to prioritise. Unowned entries marked owned: false.
  // The UI splits into "worth developing" (owned) + "worth pulling" (unowned)
  // sections with 6 entries each, so we feed it the full ranked list.
  const ceilings = computeCeilings(validStates, championLookup, champions, overrides);

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
      <RosterSummary
        roster={{ champions: validStates }}
        championLookup={championLookup}
      />

      <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-3">
        <h2 className="editorial-heading text-2xl">
          {mode === 'atomic'
            ? 'Short-term plan'
            : mode === 'plan'
              ? 'Next 10 moves'
              : 'Long-term plan'}
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
            onClick={() => setMode('plan')}
            className={`px-3 py-1 rounded transition-colors ${
              mode === 'plan'
                ? 'bg-[var(--color-paper)] font-medium'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]'
            }`}
          >
            Next 10 moves
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

      {mode === 'atomic' && (
        <AtomicMovesList
          moves={moves}
          relicMoves={relicMoves}
          relicCutoff={relicCutoff}
          championLookup={championLookup}
          onMoveDone={handleMoveDone}
        />
      )}

      {mode === 'plan' && (
        <PlanList
          plan={plan}
          championLookup={championLookup}
          onStepDone={handleMoveDone}
        />
      )}

      {mode === 'ceiling' && (
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
  relicMoves,
  relicCutoff,
  championLookup,
  onMoveDone,
}: {
  moves: ScoredMove[];
  relicMoves: ScoredRelicMove[];
  relicCutoff: number;
  championLookup: Map<string, Champion>;
  onMoveDone: (move: ScoredMove) => void;
}) {
  if (moves.length === 0 && relicMoves.length === 0) {
    return (
      <p className="text-[var(--color-ink-soft)] italic">
        No moves available. Your roster might be fully developed, or you may need
        to add more champions to enable rank-up enumeration.
      </p>
    );
  }

  // Build interleaved list of non-deferred champion moves + relic moves.
  // Both sides expose a top30Delta on the same scale (change to total
  // prestige), so a single sort produces the correct ranked recommendation.
  const interleaved: InterleavedAtomicMove[] = [
    ...moves
      .filter((m) => !m.deferRecommendation)
      .map((m): InterleavedAtomicMove => ({
        kind: 'champion',
        data: m,
        top30Delta: m.top30Delta,
      })),
    ...relicMoves.map((m): InterleavedAtomicMove => ({
      kind: 'relic',
      data: m,
      top30Delta: relicTop30Delta(m.beforeBHR, m.afterBHR, relicCutoff),
    })),
  ].sort((a, b) => b.top30Delta - a.top30Delta);

  // Deferred section stays champion-only — relic moves don't have the
  // ascend-first sequencing rule.
  const deferredMoves = moves.filter((m) => m.deferRecommendation === 'ascend-first');

  return (
    <div className="space-y-8">
      <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0">
        {interleaved.map((m, idx) => (
          <li key={moveKey(m)}>
            {m.kind === 'champion' ? (
              <MoveCard
                move={m.data}
                rank={idx + 1}
                champion={championLookup.get(m.data.move.championId)}
                onDone={() => onMoveDone(m.data)}
              />
            ) : (
              <RelicMoveCard
                move={m.data}
                rank={idx + 1}
                top30Delta={m.top30Delta}
              />
            )}
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
  cumulativeDelta,
  doneLabel,
}: {
  move: ScoredMove;
  rank: number | null;
  champion: Champion | undefined;
  onDone?: () => void;
  dimmed?: boolean;
  /** Multi-step plan only — cumulative delta after this step. */
  cumulativeDelta?: number;
  /** Override the done-button label (defaults to "✓ I've done this"). */
  doneLabel?: string;
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

        {/* Right: prestige delta + cumulative (plan mode) + BHR */}
        <div className="text-right flex-shrink-0">
          <DeltaBurst value={formatDelta(move.top30Delta)} burst={isTop} />
          {cumulativeDelta !== undefined && (
            <div className="text-[10px] text-[var(--color-ink-soft)] numeric mt-0.5">
              cumulative {formatDelta(cumulativeDelta)}
            </div>
          )}
          <div className="text-xs text-[var(--color-ink-soft)] numeric mt-0.5">
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
              {doneLabel ?? "✓ I've done this"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RelicMoveCard({
  move,
  rank,
  top30Delta,
}: {
  move: ScoredRelicMove;
  rank: number;
  top30Delta: number;
}) {
  const subject = relicMoveSubject(move);
  const description = describeRelicMove(move);
  const isTop = rank === 1;

  return (
    <div
      className={`border rounded-lg p-3 transition-colors h-full flex flex-col ${
        isTop
          ? 'border-[var(--color-marvel-impact)] bg-[var(--color-paper-card)] shadow-sm hover:bg-[var(--color-paper-soft)]'
          : 'border-[var(--color-rule)] bg-[var(--color-paper-card)] hover:bg-[var(--color-paper-soft)]'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Left column: relic badge in the portrait slot, description below.
            The badge keeps card heights aligned with champion cards in the
            grid; it also visually tells the user this is a different kind
            of recommendation without making them parse text. */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div
            className="w-16 h-16 rounded-md bg-[var(--color-paper-soft)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-marvel-editorial)] uppercase text-xs font-semibold tracking-wider"
            aria-hidden="true"
          >
            Relic
          </div>
          <div className="text-xs text-[var(--color-ink-soft)] numeric mt-1 text-center">
            {description}
          </div>
        </div>

        {/* Middle: rank number + subject */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-medium text-[var(--color-ink-soft)] numeric flex-shrink-0">
              {rank}.
            </span>
            <div className="font-medium leading-tight truncate" title={subject}>
              {subject}
            </div>
          </div>
        </div>

        {/* Right: synthetic top30Delta + BHR */}
        <div className="text-right flex-shrink-0">
          <DeltaBurst value={formatDelta(top30Delta)} burst={isTop} />
          <div className="text-xs text-[var(--color-ink-soft)] numeric">
            BHR {formatBHR(move.beforeBHR)} → {formatBHR(move.afterBHR)}
          </div>
        </div>
      </div>

      {move.notes && move.notes.length > 0 && (
        <div className="text-xs text-[var(--color-ink-soft)] italic mt-3 pt-3 border-t border-[var(--color-rule)]">
          {move.notes.join(' ')}
        </div>
      )}
    </div>
  );
}

function PlanList({
  plan,
  championLookup,
  onStepDone,
}: {
  plan: PlanStep[];
  championLookup: Map<string, Champion>;
  onStepDone: (move: ScoredMove) => void;
}) {
  if (plan.length === 0) {
    return (
      <p className="text-[var(--color-ink-soft)] italic">
        No positive-delta sequence available right now. Either your roster is
        fully developed, or the only moves left are ascend-first deferred ones
        — go ascend something and come back.
      </p>
    );
  }
  const finalCumulative = plan[plan.length - 1]!.cumulativeDelta;
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)] max-w-2xl">
        The next moves in order. Each step assumes the previous ones are
        done — that&apos;s why the deltas can change vs. the Short-term list.
        Total expected prestige gain across these 10 steps:{' '}
        <span className="numeric font-medium text-[var(--color-marvel-editorial)]">
          {formatDelta(finalCumulative)}
        </span>
        .
      </p>
      <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0">
        {plan.map((step) => (
          <li key={step.index}>
            <MoveCard
              move={step.move}
              rank={step.index}
              champion={championLookup.get(step.move.move.championId)}
              cumulativeDelta={step.cumulativeDelta}
              onDone={() => onStepDone(step.move)}
              doneLabel={`✓ I've done step ${step.index}`}
            />
          </li>
        ))}
      </ol>
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
                <DeltaBurst
                  value={formatDelta(entry.prestigeDeltaIfMaxed)}
                  burst={isTop && entry.owned}
                />
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

// ─── helpers ─────────────────────────────────────────────────────────────

/** The prestige delta. On the #1 card it gets the comic starburst (the single
 *  moment of impact); everywhere else it's restrained editorial red. */
function DeltaBurst({ value, burst }: { value: string; burst: boolean }) {
  if (burst) {
    return <span className="burst-badge text-xl">{value}</span>;
  }
  return (
    <span className="numeric font-medium text-lg text-[var(--color-marvel-editorial)]">
      {value}
    </span>
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

function describeRelicMove(move: ScoredRelicMove): string {
  const m = move.move;
  if (
    m.kind === 'level-up' ||
    m.kind === 'special-level-up' ||
    m.kind === 'battlecast6-level-up'
  ) {
    return `R${m.from.rank} L${m.from.level} → L${m.toLevel}`;
  }
  return `R${m.from.rank} L${m.from.level} → R${m.toRank}`;
}

function relicMoveSubject(move: ScoredRelicMove): string {
  const m = move.move;
  if (m.kind === 'level-up' || m.kind === 'rank-up') {
    return m.starTier === 6 ? 'Standard 6★ relic' : 'Standard 7★ relic';
  }
  if (m.kind === 'special-level-up' || m.kind === 'special-rank-up') {
    return SPECIAL_NAMES[m.id] ?? m.id;
  }
  // battlecast6-level-up / battlecast6-rank-up
  return BATTLECAST6_NAMES[m.id] ?? m.id;
}

const SPECIAL_NAMES: Record<SpecialRelicId, string> = {
  'cosmic-egg': 'The Cosmic Egg (7★)',
};

const BATTLECAST6_NAMES: Record<string, string> = {
  'cosmic-egg': 'The Cosmic Egg (6★)',
  'ant-man': 'Ant-Man (6★)',
  'black-panther': 'Black Panther (6★)',
  'black-widow': 'Black Widow (6★)',
  'captain-america-wwii': 'Captain America WWII (6★)',
  gambit: 'Gambit (6★)',
  gamora: 'Gamora (6★)',
  'ghost-rider': 'Ghost Rider (6★)',
  'green-goblin': 'Green Goblin (6★)',
  hulk: 'Hulk (6★)',
  hulkbuster: 'Hulkbuster (6★)',
  'iron-fist': 'Iron Fist (6★)',
  juggernaut: 'Juggernaut (6★)',
  'mister-sinister': 'Mister Sinister (6★)',
  'ms-marvel': 'Ms. Marvel (6★)',
  'scarlet-witch': 'Scarlet Witch (6★)',
  sentinel: 'Sentinel (6★)',
  'spider-man-2099': 'Spider-Man 2099 (6★)',
  storm: 'Storm (6★)',
  thor: 'Thor (6★)',
  valkyrie: 'Valkyrie (6★)',
  venom: 'Venom (6★)',
  vision: 'Vision (6★)',
  'winter-soldier': 'Winter Soldier (6★)',
  wolverine: 'Wolverine (6★)',
};

/**
 * Convert a relic move's raw BHR delta into a top-30-prestige-average delta
 * comparable to a champion ScoredMove.top30Delta. This is what lets us sort
 * heterogeneous moves on one axis.
 *
 * - If the move's afterBHR is at or below the cutoff, the move doesn't enter
 *   top-30 and the prestige delta is zero. (The engine pre-filters these,
 *   but the guard is defensive.)
 * - If the relic was already in top-30 (beforeBHR ≥ cutoff), the move
 *   replaces beforeBHR with afterBHR in the top-30 multiset. Delta to the
 *   average = (afterBHR − beforeBHR) / 30.
 * - Otherwise the move displaces the cutoff value. Delta = (afterBHR − cutoff) / 30.
 *
 * Caveat: we don't actually know whether `beforeBHR` was in top-30 without
 * sorting the full relic inventory. We use cutoff comparison as an
 * approximation — accurate at the boundary, gets fuzzy when many relics
 * share BHR values. Good enough for ranking moves against each other.
 */
function relicTop30Delta(beforeBHR: number, afterBHR: number, cutoff: number): number {
  if (afterBHR <= cutoff) return 0;
  if (beforeBHR >= cutoff) return (afterBHR - beforeBHR) / 30;
  return (afterBHR - cutoff) / 30;
}

function moveKey(m: InterleavedAtomicMove): string {
  if (m.kind === 'champion') {
    return `c-${m.data.move.championId}-${m.data.move.kind}`;
  }
  const rm = m.data.move;
  switch (rm.kind) {
    case 'level-up':
      return `r-${rm.starTier}-lvl-r${rm.from.rank}-l${rm.from.level}-to${rm.toLevel}`;
    case 'rank-up':
      return `r-${rm.starTier}-rnk-r${rm.from.rank}-l${rm.from.level}-to${rm.toRank}`;
    case 'special-level-up':
      return `s-${rm.id}-lvl-r${rm.from.rank}-l${rm.from.level}-to${rm.toLevel}`;
    case 'special-rank-up':
      return `s-${rm.id}-rnk-r${rm.from.rank}-l${rm.from.level}-to${rm.toRank}`;
    case 'battlecast6-level-up':
      return `b6-${rm.id}-lvl-r${rm.from.rank}-l${rm.from.level}-to${rm.toLevel}`;
    case 'battlecast6-rank-up':
      return `b6-${rm.id}-rnk-r${rm.from.rank}-l${rm.from.level}-to${rm.toRank}`;
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
