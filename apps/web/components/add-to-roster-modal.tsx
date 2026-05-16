'use client';

import { useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import { ChampionPortrait } from './champion-portrait';

type AddToRosterModalProps = {
  champion: Champion | null;
  onAdd: (state: ChampionState) => void;
  onClose: () => void;
};

/**
 * Lightweight modal to add a champion to the roster from a contextual surface
 * (e.g. "Worth pulling" cards). Pre-defaults to R4 sig 200 A0 — most owned
 * champions in a Paragon roster sit at that or near. User can adjust before
 * confirming. After adding, the recommendations recompute and the champion
 * moves from "Worth pulling" to "In your roster".
 */
export function AddToRosterModal({ champion, onAdd, onClose }: AddToRosterModalProps) {
  const [rank, setRank] = useState<3 | 4 | 5>(4);
  const [sig, setSig] = useState(200);
  const [ascension, setAscension] = useState<'A0' | 'A1' | 'A2'>('A0');

  if (!champion) return null;

  function handleSubmit() {
    if (!champion) return;
    onAdd({
      championId: champion.id,
      rank,
      sig,
      ascension,
    });
    // Reset for the next time the modal opens with a different champion
    setRank(4);
    setSig(200);
    setAscension('A0');
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${champion.name} to roster`}
    >
      <div
        className="bg-[var(--color-paper)] rounded-lg shadow-lg p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <ChampionPortrait
              name={champion.name}
              klass={champion.class}
              portraitUrl={champion.portraitUrl ?? null}
              size={48}
              showClassOverlay={Boolean(champion.portraitUrl)}
            />
            <div>
              <h3 className="editorial-heading text-lg leading-tight">
                Add {champion.name}
              </h3>
              <p className="text-xs text-[var(--color-ink-soft)]">
                {champion.class}
                {champion.ascendable && ' · ascendable'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-ink-soft)] hover:text-[var(--color-marvel-impact)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mb-1">
              Rank
            </label>
            <div className="flex gap-2">
              {[3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRank(r as 3 | 4 | 5)}
                  className={`px-3 py-1.5 border rounded text-sm numeric ${
                    rank === r
                      ? 'bg-[var(--color-paper-soft)] border-[var(--color-marvel-editorial)]'
                      : 'border-[var(--color-rule)] hover:bg-[var(--color-paper-soft)]'
                  }`}
                >
                  R{r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mb-1">
              Signature level (0–200)
            </label>
            <input
              type="number"
              min="0"
              max="200"
              value={sig}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (isNaN(v)) setSig(0);
                else setSig(Math.max(0, Math.min(200, v)));
              }}
              className="w-full px-3 py-1.5 border border-[var(--color-rule)] rounded numeric bg-[var(--color-paper-soft)]"
            />
          </div>

          {champion.ascendable && (
            <div>
              <label className="block text-xs uppercase tracking-wide text-[var(--color-ink-soft)] mb-1">
                Ascension
              </label>
              <div className="flex gap-2">
                {(['A0', 'A1', 'A2'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAscension(a)}
                    className={`px-3 py-1.5 border rounded text-sm numeric ${
                      ascension === a
                        ? 'bg-[var(--color-paper-soft)] border-[var(--color-marvel-editorial)]'
                        : 'border-[var(--color-rule)] hover:bg-[var(--color-paper-soft)]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-6 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-4 py-2 bg-[var(--color-marvel-impact)] text-white rounded hover:bg-[var(--color-marvel-editorial)] text-sm font-medium"
          >
            Add to roster
          </button>
        </div>
      </div>
    </div>
  );
}
