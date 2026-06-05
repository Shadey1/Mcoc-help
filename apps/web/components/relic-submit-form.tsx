'use client';

import { useMemo, useState } from 'react';
import {
  BATTLECAST_6STAR_CATALOG,
  BATTLECAST_6STAR_IDS,
  battlecast6Rating,
  R6_STATCAST_LEVELS,
  R6_STATCAST_RANKS,
  r6StatcastRating,
  type Battlecast6Id,
  type R6StatcastLevel,
  type R6StatcastRank,
} from '@prestige-tools/engine';
import { submitRelicReport } from '../lib/relic-report-client';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

type Kind = 'statcast' | 'battlecast';

/**
 * Unified relic submission form. Tab toggle picks 6★ Standard Statcast or
 * a specific 6★ Battlecast; the rest of the inputs (rank / sig / rating)
 * are the same shape. predictedRating + isAlpha are auto-filled from the
 * engine so the admin review sees the delta in context.
 */
export function RelicSubmitForm() {
  const [kind, setKind] = useState<Kind>('statcast');
  const [statcastRank, setStatcastRank] = useState<R6StatcastRank>('R1');
  const [statcastSig, setStatcastSig] = useState<R6StatcastLevel>(0);
  const [battlecastId, setBattlecastId] = useState<Battlecast6Id>('cosmic-egg');
  const [battlecastRank, setBattlecastRank] = useState<R6StatcastRank>('R5');
  const [battlecastSig, setBattlecastSig] = useState<R6StatcastLevel>(200);
  const [rating, setRating] = useState<string>('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  const statcastPredicted = useMemo(
    () => r6StatcastRating(statcastRank, statcastSig),
    [statcastRank, statcastSig],
  );
  const battlecastPredicted = useMemo(
    () => battlecast6Rating(battlecastId, battlecastRank, battlecastSig),
    [battlecastId, battlecastRank, battlecastSig],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(rating);
    if (!Number.isFinite(n) || n <= 0) {
      setState({ kind: 'error', message: 'Rating must be a positive number' });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      if (kind === 'statcast') {
        await submitRelicReport({
          kind: 'statcast',
          rank: statcastRank,
          level: statcastSig,
          rating: Math.round(n),
          predictedRating: statcastPredicted.rating,
          isAlpha: statcastPredicted.isAlpha,
        });
      } else {
        await submitRelicReport({
          kind: 'battlecast',
          relicId: battlecastId,
          rank: battlecastRank,
          level: battlecastSig,
          rating: Math.round(n),
          predictedRating: battlecastPredicted?.rating ?? null,
          isAlpha: battlecastPredicted?.source === 'mcochub-alpha' ? true : false,
        });
      }
      setState({ kind: 'success' });
      setRating('');
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Submit failed',
      });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-[var(--color-rule)] rounded bg-[var(--color-paper-card)] p-4 space-y-3"
    >
      <div>
        <h3 className="editorial-heading text-xl mb-1">Submit a 6★ reading</h3>
        <p className="text-xs text-[var(--color-ink-soft)]">
          Tap one of your 6★ relics in-game, read the rating off the card,
          pick the rank/sig here, and submit. Anonymous, opt-in, no other
          data captured. The more readings come in, the more α estimates
          flip to verified above.
        </p>
      </div>

      <div className="inline-flex border border-[var(--color-rule)] rounded overflow-hidden text-xs">
        {(['statcast', 'battlecast'] as Kind[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={`px-3 py-1.5 ${
              kind === option
                ? 'bg-[var(--color-marvel-impact)] text-white font-medium'
                : 'bg-[var(--color-paper)] hover:bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)]'
            }`}
          >
            {option === 'statcast' ? 'Standard Statcast' : 'Battlecast'}
          </button>
        ))}
      </div>

      {kind === 'statcast' ? (
        <StatcastFields
          rank={statcastRank}
          sig={statcastSig}
          onRank={setStatcastRank}
          onSig={setStatcastSig}
          rating={rating}
          onRating={setRating}
          predictedLabel={`${statcastPredicted.rating.toLocaleString()}${
            statcastPredicted.isAlpha ? ' (α)' : ' (verified)'
          }`}
          submitting={state.kind === 'submitting'}
        />
      ) : (
        <BattlecastFields
          id={battlecastId}
          rank={battlecastRank}
          sig={battlecastSig}
          onId={setBattlecastId}
          onRank={setBattlecastRank}
          onSig={setBattlecastSig}
          rating={rating}
          onRating={setRating}
          predictedLabel={
            battlecastPredicted
              ? `${battlecastPredicted.rating.toLocaleString()}${
                  battlecastPredicted.source === 'verified'
                    ? ' (verified)'
                    : ' (α, MCOCHUB)'
                }`
              : '— no data at this state'
          }
          submitting={state.kind === 'submitting'}
        />
      )}

      {state.kind === 'success' && (
        <div className="text-xs text-emerald-700">
          Submitted. Thanks — that&apos;s another anchor closer to fact.
        </div>
      )}
      {state.kind === 'error' && (
        <div className="text-xs text-[var(--color-marvel-impact)]">
          {state.message}
        </div>
      )}
    </form>
  );
}

function StatcastFields({
  rank,
  sig,
  onRank,
  onSig,
  rating,
  onRating,
  predictedLabel,
  submitting,
}: {
  rank: R6StatcastRank;
  sig: R6StatcastLevel;
  onRank: (r: R6StatcastRank) => void;
  onSig: (s: R6StatcastLevel) => void;
  rating: string;
  onRating: (r: string) => void;
  predictedLabel: string;
  submitting: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
        <RankField rank={rank} onRank={onRank} />
        <SigField sig={sig} onSig={onSig} />
        <RatingField rating={rating} onRating={onRating} />
        <SubmitButton submitting={submitting} disabled={rating.trim() === ''} />
      </div>
      <div className="text-xs text-[var(--color-ink-soft)]">
        Our current value for {rank} sig {sig}:{' '}
        <span className="numeric">{predictedLabel}</span>
      </div>
    </>
  );
}

function BattlecastFields({
  id,
  rank,
  sig,
  onId,
  onRank,
  onSig,
  rating,
  onRating,
  predictedLabel,
  submitting,
}: {
  id: Battlecast6Id;
  rank: R6StatcastRank;
  sig: R6StatcastLevel;
  onId: (i: Battlecast6Id) => void;
  onRank: (r: R6StatcastRank) => void;
  onSig: (s: R6StatcastLevel) => void;
  rating: string;
  onRating: (r: string) => void;
  predictedLabel: string;
  submitting: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
        <label className="text-xs">
          Relic
          <select
            value={id}
            onChange={(e) => onId(e.target.value as Battlecast6Id)}
            className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          >
            {BATTLECAST_6STAR_IDS.map((bid) => (
              <option key={bid} value={bid}>
                {BATTLECAST_6STAR_CATALOG[bid].name}
              </option>
            ))}
          </select>
        </label>
        <RankField rank={rank} onRank={onRank} />
        <SigField sig={sig} onSig={onSig} />
        <RatingField rating={rating} onRating={onRating} />
        <SubmitButton submitting={submitting} disabled={rating.trim() === ''} />
      </div>
      <div className="text-xs text-[var(--color-ink-soft)]">
        Our current value for {BATTLECAST_6STAR_CATALOG[id].name} {rank} sig {sig}:{' '}
        <span className="numeric">{predictedLabel}</span>
      </div>
    </>
  );
}

function RankField({
  rank,
  onRank,
}: {
  rank: R6StatcastRank;
  onRank: (r: R6StatcastRank) => void;
}) {
  return (
    <label className="text-xs">
      Rank
      <select
        value={rank}
        onChange={(e) => onRank(e.target.value as R6StatcastRank)}
        className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
      >
        {R6_STATCAST_RANKS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </label>
  );
}

function SigField({
  sig,
  onSig,
}: {
  sig: R6StatcastLevel;
  onSig: (s: R6StatcastLevel) => void;
}) {
  return (
    <label className="text-xs">
      Sig
      <select
        value={sig}
        onChange={(e) => onSig(Number(e.target.value) as R6StatcastLevel)}
        className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
      >
        {R6_STATCAST_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function RatingField({
  rating,
  onRating,
}: {
  rating: string;
  onRating: (r: string) => void;
}) {
  return (
    <label className="text-xs">
      Rating (from in-game)
      <input
        type="number"
        inputMode="numeric"
        value={rating}
        onChange={(e) => onRating(e.target.value)}
        className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] numeric"
      />
    </label>
  );
}

function SubmitButton({
  submitting,
  disabled,
}: {
  submitting: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={submitting || disabled}
      className="px-4 py-1.5 bg-[var(--color-marvel-impact)] text-white text-sm font-medium rounded disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed"
    >
      {submitting ? 'Submitting…' : 'Submit'}
    </button>
  );
}
