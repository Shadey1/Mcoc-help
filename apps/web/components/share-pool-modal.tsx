'use client';

import { useState } from 'react';
import type { Ascension, Rank } from '@prestige-tools/engine';
import { createSharedPool } from '../lib/share-pool-client';
import type { WarPlayerInput } from '../lib/war-storage';

type ShareModalState =
  | { phase: 'form' }
  | { phase: 'generating' }
  | { phase: 'done'; url: string; deleteToken: string; expiresAt: string }
  | { phase: 'error'; message: string };

type Props = {
  open: boolean;
  onClose: () => void;
  pool: string[];
  floor: { rank: Rank; ascension: Ascension };
  /** Three BG roster-paste lists — bundled into the share when non-empty. */
  bgs?: WarPlayerInput[][];
};

/**
 * Share-pool modal — generates a /war?pool=<id> URL the officer can drop in
 * the alliance chat. Members open it and the war planner offers to swap in
 * the shared pool + floor. Mirrors the roster ShareModal pattern.
 */
export function SharePoolModal({ open, onClose, pool, floor, bgs }: Props) {
  const [label, setLabel] = useState('');
  const [state, setState] = useState<ShareModalState>({ phase: 'form' });
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const bgPlayerCounts = (bgs ?? [[], [], []]).map(
    (group) => group.filter((r) => r.url.trim().length > 0).length,
  );
  const totalBgPlayers = bgPlayerCounts.reduce((a, b) => a + b, 0);

  async function handleGenerate() {
    setState({ phase: 'generating' });
    try {
      const result = await createSharedPool(
        pool,
        floor,
        label.trim() || null,
        bgs,
      );
      const url = `${window.location.origin}/war/?pool=${result.id}`;
      setState({
        phase: 'done',
        url,
        deleteToken: result.deleteToken,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Share failed',
      });
    }
  }

  function handleClose() {
    setLabel('');
    setState({ phase: 'form' });
    setCopied(false);
    onClose();
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById(
        'pool-url-input',
      ) as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-[var(--color-paper)] border border-[var(--color-rule)] rounded-lg max-w-lg w-full p-6 shadow-xl">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="editorial-heading text-2xl">Share defender pool</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {state.phase === 'form' && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-ink-soft)]">
              Generate a link that loads your defender pool ({pool.length}{' '}
              champions) and minimum-rank floor ({`R${floor.rank}`}) into
              the war planner.{' '}
              {totalBgPlayers > 0 ? (
                <>
                  Also bundling the share URLs you&apos;ve pasted into BG1/2/3
                  ({bgPlayerCounts.join(' / ')} = {totalBgPlayers} players)
                  so the recipient gets the full war snapshot. Otherwise
                  their own roster URLs stay theirs.
                </>
              ) : (
                <>
                  Alliance members open it, click load — their own roster
                  URLs and placements stay theirs.
                </>
              )}{' '}
              Link expires in 6 months.
            </p>

            <div>
              <label
                htmlFor="pool-share-label"
                className="block text-sm font-medium mb-1"
              >
                Label{' '}
                <span className="text-[var(--color-ink-soft)] font-normal">
                  (optional)
                </span>
              </label>
              <input
                id="pool-share-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. LONGSHOT — Jun 2026 meta"
                maxLength={100}
                className="w-full px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
              />
              <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                Shows when members load the pool so they know the source.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={pool.length === 0}
                className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate share link
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.phase === 'generating' && (
          <div className="py-8 text-center text-[var(--color-ink-soft)]">
            Generating link…
          </div>
        )}

        {state.phase === 'done' && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-ink-soft)]">
              Drop this in the alliance chat. Members click → war planner
              offers to import. Expires{' '}
              <span className="numeric">
                {new Date(state.expiresAt).toLocaleDateString()}
              </span>
              .
            </p>

            <div className="flex gap-2">
              <input
                id="pool-url-input"
                type="text"
                value={state.url}
                readOnly
                onFocus={(e) => e.target.select()}
                className="flex-1 px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] numeric text-sm"
              />
              <button
                type="button"
                onClick={() => copyUrl(state.url)}
                className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors min-w-[80px]"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <details className="text-xs text-[var(--color-ink-soft)]">
              <summary className="cursor-pointer hover:text-[var(--color-ink)]">
                Delete this share later
              </summary>
              <div className="mt-2 space-y-1 pl-2">
                <p>Save this delete token if you want to revoke the share early:</p>
                <code className="block p-2 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded numeric break-all">
                  {state.deleteToken}
                </code>
              </div>
            </details>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
              <strong>Couldn&apos;t generate share link:</strong>{' '}
              {state.message}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setState({ phase: 'form' })}
                className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
