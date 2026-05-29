'use client';

import { useRef, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import {
  seedPortraitStore,
  type SeedProgress,
} from '../lib/ocr/portrait-seeder';
import type { IdentifiedCard } from '../lib/ocr/types';
import { portraitStoreSize, loadPortraitStore } from '../lib/ocr/portrait-store';
import { FEEDBACK_FORM_URL } from '../lib/feedback';
import { ConfirmationGrid } from './confirmation-grid';

type Props = {
  champions: Champion[];
  onImport?: (states: ChampionState[]) => void;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'queued'; files: File[] }
  | { kind: 'seeding'; progress: SeedProgress | null }
  | { kind: 'review'; cards: IdentifiedCard[] }
  | { kind: 'error'; message: string };

export function PortraitSeed({ champions, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  const storeInfo = portraitStoreSize(loadPortraitStore());

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) {
      setPhase({ kind: 'queued', files });
    }
    e.target.value = '';
  }

  async function runSeeding() {
    if (phase.kind !== 'queued') return;
    const files = phase.files;
    setPhase({ kind: 'seeding', progress: null });
    try {
      const result = await seedPortraitStore(files, champions, (update) => {
        setPhase({ kind: 'seeding', progress: update });
      });
      if (result.cards.length === 0) {
        setPhase({
          kind: 'error',
          message:
            'No champions could be read from those screenshots. Make sure they are the My Champions page sorted by BHR.',
        });
        return;
      }
      setPhase({ kind: 'review', cards: result.cards });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Seeding failed',
      });
    }
  }

  if (phase.kind === 'review') {
    return (
      <ConfirmationGrid
        cards={phase.cards}
        champions={champions}
        onConfirm={(states) => {
          onImport?.(states);
          setPhase({ kind: 'idle' });
        }}
        onCancel={() => setPhase({ kind: 'idle' })}
      />
    );
  }

  if (phase.kind === 'seeding') {
    const msg = phase.progress
      ? phase.progress.kind === 'scanning'
        ? `Scouring the multiverse for your champions… (scan ${phase.progress.screenshot + 1} of ${phase.progress.total})`
        : phase.progress.kind === 'names-found'
          ? `Spotted ${phase.progress.count} champions in scan ${phase.progress.screenshot + 1}…`
          : phase.progress.kind === 'seeding'
            ? `Reading ${phase.progress.champion}…`
            : 'Assembling your roster…'
      : 'Opening a portal to the multiverse…';
    return (
      <div className="flex items-center gap-3 text-sm">
        <div className="w-4 h-4 border-2 border-[var(--color-marvel-impact)] border-t-transparent rounded-full animate-spin" />
        <span>{msg}</span>
      </div>
    );
  }

  function queueFiles(newFiles: File[]) {
    setPhase((prev) => {
      const existing = prev.kind === 'queued' ? prev.files : [];
      return { kind: 'queued', files: [...existing, ...newFiles] };
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (phase.kind === 'seeding') return;
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) queueFiles(files);
  }

  return (
    <div className="space-y-3">
      <div className="text-sm space-y-2">
        <div className="flex items-center gap-2">
          <strong>Upload your roster</strong>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-marvel-impact)] text-[var(--color-paper)]">
            Alpha
          </span>
        </div>
        <ol className="text-xs text-[var(--color-ink-soft)] list-decimal list-inside space-y-1">
          <li>
            In-game, open <strong>My Champions</strong> and{' '}
            <strong>sort by BHR</strong> (Base Hero Rating).{' '}
            <strong className="text-[var(--color-marvel-impact)]">
              Sorting by PI won&apos;t work.
            </strong>
          </li>
          <li>
            Screenshot the list — scroll and grab as many as you need to cover
            your roster.
          </li>
          <li>
            Drop them all here. We read each champion, BHR and ascension, then
            derive rank &amp; signature.
          </li>
        </ol>
        <p className="text-xs text-[var(--color-ink-soft)]">
          This is an early <strong>alpha</strong> and we&apos;re actively
          iterating — reads aren&apos;t perfect yet, so you get a review step to
          fix anything before it&apos;s added to your roster.{' '}
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-marvel-impact)] underline hover:text-[var(--color-marvel-editorial)]"
          >
            Spotted a wrong champion or a bad read? Send anonymous feedback →
          </a>
        </p>
        {storeInfo.totalPortraits > 0 && (
          <p className="text-xs text-[var(--color-ink-soft)]">
            Saved so far: {storeInfo.champions} champions,{' '}
            {storeInfo.totalPortraits} portraits.
          </p>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        className="border-2 border-dashed border-[var(--color-rule)] rounded-lg p-6 text-center bg-[var(--color-paper-soft)] hover:border-[var(--color-marvel-impact)] transition-colors"
      >
        <div className="text-sm text-[var(--color-ink-soft)] space-y-1">
          <p><strong>Drop screenshots here</strong></p>
          <p className="text-xs">
            Or{' '}
            <label className="underline hover:text-[var(--color-marvel-impact)] cursor-pointer">
              pick from file
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onFileChange}
                className="hidden"
              />
            </label>
          </p>
        </div>
      </div>

      {phase.kind === 'queued' && (
        <div className="flex gap-2 items-center">
          <span className="text-sm">
            {phase.files.length} screenshot{phase.files.length > 1 ? 's' : ''}{' '}
            ready
          </span>
          <button
            type="button"
            onClick={runSeeding}
            className="px-3 py-1.5 text-sm bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
          >
            Seed portraits
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="text-xs underline text-[var(--color-ink-soft)]"
          >
            Clear
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded p-3">
          <strong>Failed.</strong>
          <p className="text-xs mt-1">{phase.message}</p>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="text-xs underline mt-2"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
