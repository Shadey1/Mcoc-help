'use client';

import { useEffect, useRef, useState } from 'react';
import {
  calculateBHR,
  type Ascension,
  type Champion,
  type ChampionState,
  type Rank,
} from '@prestige-tools/engine';
import { formatBHR } from '../lib/format';
import { useBHROverrides } from '../lib/bhr-overrides-context';
import {
  isReported,
  loadReportedKeys,
  markReported,
  submitCalibrationReport,
} from '../lib/calibration-report-client';

/**
 * BHR display cell with inline calibration override.
 *
 * Default: shows the displayed BHR (already override-aware via the engine
 * threading) with a subtle edit affordance. A small dot indicates when an
 * override is active.
 *
 * Click to expand into an inline editor: shows the predicted (curve) value
 * for comparison, takes a user-entered actual BHR, saves it to localStorage.
 * The override applies ONLY to this exact (champion, rank, sig, ascension)
 * state — not to other states for the same champion.
 *
 * Local-only by design. See task #41 for the optional report-back flow.
 */
type PendingReport = {
  predictedBhr: number;
  actualBhr: number;
};

export function BhrCell({
  champion,
  state,
  displayedBhr,
}: {
  champion: Champion | undefined;
  state: ChampionState;
  displayedBhr: number;
}) {
  const { hasOverride, setOverride, clearOverride } = useBHROverrides();
  const [editing, setEditing] = useState(false);
  const [pendingReport, setPendingReport] = useState<PendingReport | null>(null);
  const [reportedKeys, setReportedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setReportedKeys(loadReportedKeys());
  }, []);

  if (!champion) {
    // No champion data — fall back to plain display.
    return <span className="numeric">{formatBHR(displayedBhr)}</span>;
  }

  const rank = state.rank as Rank;
  const ascension = state.ascension as Ascension;
  const overridden = hasOverride(state.championId, rank, state.sig, ascension);
  const alreadyReported = isReported(
    state.championId,
    rank,
    state.sig,
    ascension,
    reportedKeys,
  );

  if (editing) {
    return (
      <BhrEditor
        champion={champion}
        state={state}
        overridden={overridden}
        onSave={(value) => {
          const predicted = calculateBHR(champion, state);
          setOverride({
            championId: state.championId,
            rank,
            sig: state.sig,
            ascension,
            value,
          });
          setEditing(false);
          // Prompt to share back only if the value actually differs from
          // the curve AND we haven't already reported this exact state.
          if (value !== predicted && !alreadyReported) {
            setPendingReport({ predictedBhr: predicted, actualBhr: value });
          }
        }}
        onClear={() => {
          clearOverride(state.championId, rank, state.sig, ascension);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (pendingReport) {
    return (
      <ReportPrompt
        report={{
          championId: state.championId,
          rank,
          sig: state.sig,
          ascension,
          predictedBhr: pendingReport.predictedBhr,
          actualBhr: pendingReport.actualBhr,
        }}
        displayedBhr={displayedBhr}
        onResolved={() => {
          // Refresh reported set so subsequent opens don't re-prompt
          setReportedKeys(loadReportedKeys());
          setPendingReport(null);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="numeric inline-flex items-center gap-1.5 hover:text-[var(--color-marvel-impact)] transition-colors group"
      title={
        overridden
          ? 'Calibrated by you. Click to edit or remove.'
          : 'Click to pin the actual in-game BHR for this state'
      }
    >
      <span>{formatBHR(displayedBhr)}</span>
      {overridden ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-emerald-600"
          aria-label="calibrated"
        />
      ) : (
        <span
          className="text-[10px] text-[var(--color-ink-soft)]/40 group-hover:text-[var(--color-marvel-impact)] transition-colors"
          aria-hidden="true"
        >
          ✎
        </span>
      )}
    </button>
  );
}

function ReportPrompt({
  report,
  displayedBhr,
  onResolved,
}: {
  report: {
    championId: string;
    rank: Rank;
    sig: number;
    ascension: Ascension;
    predictedBhr: number;
    actualBhr: number;
  };
  displayedBhr: number;
  onResolved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await submitCalibrationReport(report);
      markReported(report);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
      setSubmitting(false);
    }
  }

  function dismiss() {
    // Treat dismissal as "they decided not to share for this state" — record
    // it so we don't pester again. They can always edit + resubmit later.
    markReported(report);
    onResolved();
  }

  return (
    <div className="inline-flex flex-col items-start gap-1 bg-[var(--color-paper)] border border-emerald-600/40 rounded px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="numeric text-sm">{formatBHR(displayedBhr)}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        <span className="text-xs text-[var(--color-ink-soft)]">
          saved locally
        </span>
      </div>
      <div className="text-[11px] text-[var(--color-ink-soft)] leading-snug max-w-[18rem]">
        Help mcoc.help — submit this correction anonymously (predicted{' '}
        {formatBHR(report.predictedBhr)}, actual {formatBHR(report.actualBhr)},
        Δ {report.actualBhr - report.predictedBhr > 0 ? '+' : ''}
        {report.actualBhr - report.predictedBhr})?
      </div>
      {error && (
        <div className="text-[11px] text-[var(--color-marvel-impact)]">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 mt-0.5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="text-[11px] px-2 py-0.5 bg-emerald-700 text-white rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Submit'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={submitting}
          className="text-[11px] px-2 py-0.5 text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] underline disabled:opacity-50"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

function BhrEditor({
  champion,
  state,
  overridden,
  onSave,
  onClear,
  onCancel,
}: {
  champion: Champion;
  state: ChampionState;
  overridden: boolean;
  onSave: (value: number) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  // Compute the curve-predicted value (no overrides) so the user can
  // compare against their measured number.
  const predicted = calculateBHR(champion, state);
  const [value, setValue] = useState<string>(predicted.toString());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    onSave(Math.round(n));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="inline-flex items-center gap-2 bg-[var(--color-paper)] border border-[var(--color-marvel-editorial)] rounded px-2 py-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs text-[var(--color-ink-soft)] whitespace-nowrap">
        Predicted {formatBHR(predicted)} ·
      </span>
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="numeric w-20 px-1.5 py-0.5 text-sm border border-[var(--color-rule)] rounded focus:outline-none focus:border-[var(--color-marvel-impact)]"
        aria-label="Actual in-game BHR"
      />
      <button
        type="submit"
        className="text-xs px-2 py-0.5 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] rounded hover:opacity-90"
        title="Save calibration"
      >
        Save
      </button>
      {overridden && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs px-2 py-0.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
          title="Remove override, use the curve value"
        >
          Clear
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] px-1"
        aria-label="Cancel"
      >
        ✗
      </button>
    </form>
  );
}
