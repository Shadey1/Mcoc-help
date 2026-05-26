'use client';

import { useRef, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import {
  seedPortraitStore,
  type SeedProgress,
  type SeedResult,
} from '../lib/ocr/portrait-seeder';
import { portraitStoreSize, loadPortraitStore } from '../lib/ocr/portrait-store';

type Props = {
  champions: Champion[];
  onImport?: (states: ChampionState[]) => void;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'queued'; files: File[] }
  | { kind: 'seeding'; progress: SeedProgress | null }
  | { kind: 'done'; result: SeedResult }
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
      setPhase({ kind: 'done', result });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Seeding failed',
      });
    }
  }

  if (phase.kind === 'done') {
    const stateCount = phase.result.rosterStates.length;
    return (
      <div className="space-y-3">
        <div className="text-sm bg-green-50 border border-green-300 text-green-900 rounded p-3">
          <strong>
            Identified {phase.result.seeded} champions
            {stateCount > 0 && `, derived state for ${stateCount}`}.
          </strong>
          <p className="text-xs mt-1">
            Portraits saved for future identification. Champions with BHR
            readings had their rank/sig/ascension derived from the engine math.
            States are marked unconfirmed — review them in your roster table.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {onImport && stateCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onImport(phase.result.rosterStates);
                setPhase({ kind: 'idle' });
              }}
              className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
            >
              Import {stateCount} champions to roster
            </button>
          )}
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="text-xs underline text-[var(--color-ink-soft)]"
          >
            {stateCount > 0 ? 'Skip import' : 'Seed more'}
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'seeding') {
    const msg = phase.progress
      ? phase.progress.kind === 'scanning'
        ? `Scanning screenshot ${phase.progress.screenshot + 1} of ${phase.progress.total}…`
        : phase.progress.kind === 'names-found'
          ? `Found ${phase.progress.count} champions in screenshot ${phase.progress.screenshot + 1}`
          : phase.progress.kind === 'seeding'
            ? `Saving portrait ${phase.progress.current + 1}/${phase.progress.total}: ${phase.progress.champion}`
            : 'Done'
      : 'Starting…';
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
      <div className="text-sm">
        <strong>Seed portrait library</strong> from My Champions screenshots.
        <p className="text-xs text-[var(--color-ink-soft)] mt-1">
          Screenshot your My Champions page (sorted by BHR) from the Windows
          app. Drop them here — the tool reads the champion names from the
          screenshots and saves each portrait for future identification.
          {storeInfo.totalPortraits > 0 && (
            <span className="ml-1">
              Current store: {storeInfo.champions} champions,{' '}
              {storeInfo.totalPortraits} portraits.
            </span>
          )}
        </p>
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
