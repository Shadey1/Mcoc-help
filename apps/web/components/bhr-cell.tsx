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

  if (!champion) {
    // No champion data — fall back to plain display.
    return <span className="numeric">{formatBHR(displayedBhr)}</span>;
  }

  const rank = state.rank as Rank;
  const overridden = hasOverride(state.championId, rank, state.sig, state.ascension);

  if (editing) {
    return (
      <BhrEditor
        champion={champion}
        state={state}
        overridden={overridden}
        onSave={(value) => {
          setOverride({
            championId: state.championId,
            rank,
            sig: state.sig,
            ascension: state.ascension as Ascension,
            value,
          });
          setEditing(false);
        }}
        onClear={() => {
          clearOverride(state.championId, rank, state.sig, state.ascension as Ascension);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
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
