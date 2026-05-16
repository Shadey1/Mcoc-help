'use client';

import { useState } from 'react';
import type { ChampionState } from '@prestige-tools/engine';
import { createShare, recordLocalShare } from '../lib/share-client';

type ShareModalProps = {
  open: boolean;
  onClose: () => void;
  roster: ChampionState[];
};

type ModalState =
  | { phase: 'form' }
  | { phase: 'generating' }
  | { phase: 'done'; url: string; deleteToken: string; expiresAt: string }
  | { phase: 'error'; message: string };

/**
 * Modal flow:
 *   1. User opens — sees label field + "Generate share link" button
 *   2. Clicks generate — calls POST /api/share
 *   3. On success — shows URL with copy button + delete-this-share option
 *   4. On error — shows message + retry
 *
 * The delete token is preserved client-side so the user can nuke the share
 * later from the My Shares list (not implemented in this iteration — Phase 2).
 */
export function ShareModal({ open, onClose, roster }: ShareModalProps) {
  const [label, setLabel] = useState('');
  const [state, setState] = useState<ModalState>({ phase: 'form' });
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function handleGenerate() {
    setState({ phase: 'generating' });
    try {
      const result = await createShare(roster, label.trim() || null);
      const url = `${window.location.origin}/r/?id=${result.id}`;

      recordLocalShare({
        id: result.id,
        deleteToken: result.deleteToken,
        label: label.trim() || null,
        createdAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      });

      setState({ phase: 'done', url, deleteToken: result.deleteToken, expiresAt: result.expiresAt });
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
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
      // Clipboard API can fail in some browsers / contexts — fall back to selecting
      const input = document.getElementById('share-url-input') as HTMLInputElement | null;
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
          <h2 className="editorial-heading text-2xl">Share your roster</h2>
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
              Generate a link that shows your current roster ({roster.length} champions) as
              view-only. Useful for alliance war / AQ planning — recipients see what you've
              got but can't edit it. Link expires in 6 months.
            </p>

            <div>
              <label htmlFor="share-label" className="block text-sm font-medium mb-1">
                Label <span className="text-[var(--color-ink-soft)] font-normal">(optional)</span>
              </label>
              <input
                id="share-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. mu3rto / LONGSHOT"
                maxLength={100}
                className="w-full px-3 py-2 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
              />
              <p className="text-xs text-[var(--color-ink-soft)] mt-1">
                Shows on the shared page so people know whose roster it is. No verification.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={roster.length === 0}
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
          <div className="py-8 text-center text-[var(--color-ink-soft)]">Generating link…</div>
        )}

        {state.phase === 'done' && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-ink-soft)]">
              Your share link is ready. Anyone with this URL can view your roster (read-only).
              The link expires on{' '}
              <span className="numeric">
                {new Date(state.expiresAt).toLocaleDateString()}
              </span>
              .
            </p>

            <div className="flex gap-2">
              <input
                id="share-url-input"
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
                <p>
                  Save this delete token in case you want to remove the share before it expires:
                </p>
                <code className="block p-2 bg-[var(--color-paper-soft)] border border-[var(--color-rule)] rounded numeric break-all">
                  {state.deleteToken}
                </code>
                <p>
                  We've also saved it in your browser&apos;s local storage. To delete:
                  <code className="block mt-1">
                    DELETE /api/share/{state.url.split('id=')[1]}?token={state.deleteToken}
                  </code>
                </p>
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
              <strong>Couldn&apos;t generate share link:</strong> {state.message}
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
