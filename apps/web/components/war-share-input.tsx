'use client';

import type { WarPlayerInput } from '../lib/war-storage';

/**
 * Paste-share-URLs input — up to 10 rows, each holding a share URL and an
 * optional in-game name override.
 *
 * Officer pastes URLs from the alliance Line chat (or Discord, whatever).
 * Each URL points at a /r?id=abc share. The name override is for when the
 * label baked into the share doesn't match the player's in-game name.
 *
 * Pure presentational — fetching, status display, and load orchestration
 * live one level up in WarPlanner so the same in-flight state flows into
 * the engine call and the output table.
 */

export type WarShareRowStatus =
  | { state: 'empty' }
  | { state: 'loading' }
  | { state: 'loaded'; label: string | null; champCount: number }
  | { state: 'error'; message: string };

type Props = {
  rows: WarPlayerInput[];
  statuses: WarShareRowStatus[];
  onChange: (rows: WarPlayerInput[]) => void;
};

const MAX_ROWS = 10;

export function WarShareInput({ rows, statuses, onChange }: Props) {
  const padded = [...rows];
  while (padded.length < Math.max(rows.length, 1)) {
    padded.push({ url: '', name: '' });
  }

  function updateRow(idx: number, patch: Partial<WarPlayerInput>) {
    const next = padded.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  }

  function addRow() {
    if (padded.length >= MAX_ROWS) return;
    onChange([...padded, { url: '', name: '' }]);
  }

  function removeRow(idx: number) {
    onChange(padded.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_auto_auto] gap-2 text-xs text-[var(--color-ink-soft)] px-1">
        <span>Share URL</span>
        <span className="hidden sm:block">In-game name (optional override)</span>
        <span className="hidden sm:block text-center">Status</span>
        <span></span>
      </div>
      {padded.map((row, idx) => {
        const status = statuses[idx] ?? { state: 'empty' };
        return (
          <div
            key={idx}
            className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_1fr_auto_auto] gap-2 items-center"
          >
            <input
              type="text"
              value={row.url}
              onChange={(e) => updateRow(idx, { url: e.target.value })}
              placeholder="https://mcoc.help/r/?id=…"
              className="px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] min-w-0"
            />
            <input
              type="text"
              value={row.name}
              onChange={(e) => updateRow(idx, { name: e.target.value })}
              placeholder={
                status.state === 'loaded' && status.label
                  ? status.label
                  : `Player ${idx + 1}`
              }
              className="hidden sm:block px-2 py-1.5 text-sm border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)] min-w-0"
            />
            <StatusBadge status={status} />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] px-1.5 py-1 text-sm"
              title="Remove row"
              aria-label="Remove row"
            >
              ✗
            </button>
          </div>
        );
      })}
      {padded.length < MAX_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="text-xs text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)] underline mt-1"
        >
          + add row ({padded.length}/{MAX_ROWS})
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: WarShareRowStatus }) {
  switch (status.state) {
    case 'empty':
      return (
        <span className="text-xs text-[var(--color-ink-soft)]/50 text-center min-w-[5rem]">
          —
        </span>
      );
    case 'loading':
      return (
        <span className="text-xs text-[var(--color-ink-soft)] text-center min-w-[5rem]">
          loading…
        </span>
      );
    case 'loaded':
      return (
        <span
          className="text-xs text-emerald-700 text-center min-w-[5rem]"
          title={`${status.champCount} champions loaded`}
        >
          ✓ {status.champCount}
        </span>
      );
    case 'error':
      return (
        <span
          className="text-xs text-[var(--color-marvel-impact)] text-center min-w-[5rem] truncate"
          title={status.message}
        >
          error
        </span>
      );
  }
}

/**
 * Extract the share id from a pasted value. Accepts:
 *   - full URLs: https://mcoc.help/r/?id=abc123
 *   - URLs without scheme: mcoc.help/r/?id=abc123
 *   - just the id itself: abc123
 * Returns null if no id can be recovered.
 */
export function extractShareId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const queryMatch = trimmed.match(/[?&]id=([^&\s#]+)/);
  if (queryMatch) return queryMatch[1] ?? null;
  // Bare-id case: shares ids are alphanumeric, no spaces or slashes
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && !trimmed.includes('/')) return trimmed;
  return null;
}
