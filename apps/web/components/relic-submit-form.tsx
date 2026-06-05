'use client';

import { useMemo, useState } from 'react';
import {
  R6_STATCAST_LEVELS,
  R6_STATCAST_RANKS,
  r6StatcastRating,
  type R6StatcastLevel,
  type R6StatcastRank,
} from '@prestige-tools/engine';
import { submitRelicReport } from '../lib/relic-report-client';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

/**
 * Submit-a-relic-reading form — collects (rank, level, rating) from a
 * 6★ Standard Statcast the user can read in-game, posts to the
 * /api/relic-report KV-backed endpoint. The predictedRating + isAlpha
 * flag from r6StatcastRating() are included so the admin review sees
 * the delta and can prioritise corrections that flip alpha to fact.
 *
 * Same opt-in pattern as the champion BHR calibration report — anonymous,
 * no user identifier collected, lives entirely on the user's explicit
 * "Submit" click.
 */
export function RelicSubmitForm() {
  const [rank, setRank] = useState<R6StatcastRank>('R1');
  const [level, setLevel] = useState<R6StatcastLevel>(0);
  const [rating, setRating] = useState<string>('');
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  const predicted = useMemo(() => r6StatcastRating(rank, level), [rank, level]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(rating);
    if (!Number.isFinite(n) || n <= 0) {
      setState({ kind: 'error', message: 'Rating must be a positive number' });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      await submitRelicReport({
        rank,
        level,
        rating: Math.round(n),
        predictedRating: predicted.rating,
        isAlpha: predicted.isAlpha,
      });
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
          Tap one of your 6★ Standard Statcasts in-game, read the rating off
          the card, pick the rank/level here, and submit. Anonymous, opt-in,
          no other data captured. The more readings come in, the more α
          estimates flip to verified above.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
        <label className="text-xs">
          Rank
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value as R6StatcastRank)}
            className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          >
            {R6_STATCAST_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Level
          <select
            value={level}
            onChange={(e) =>
              setLevel(Number(e.target.value) as R6StatcastLevel)
            }
            className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
          >
            {R6_STATCAST_LEVELS.map((l) => (
              <option key={l} value={l}>
                L{l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Rating (from in-game)
          <input
            type="number"
            inputMode="numeric"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            placeholder={predicted.rating.toString()}
            className="block w-full mt-1 px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] numeric"
          />
        </label>
        <button
          type="submit"
          disabled={state.kind === 'submitting' || rating.trim() === ''}
          className="px-4 py-1.5 bg-[var(--color-marvel-impact)] text-white text-sm font-medium rounded disabled:bg-[var(--color-ink-soft)] disabled:cursor-not-allowed"
        >
          {state.kind === 'submitting' ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      <div className="text-xs text-[var(--color-ink-soft)]">
        Our current value for {rank} L{level}:{' '}
        <span className="numeric">{predicted.rating.toLocaleString()}</span>
        {predicted.isAlpha ? ' (α — alpha estimate)' : ' (verified)'}
      </div>
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
