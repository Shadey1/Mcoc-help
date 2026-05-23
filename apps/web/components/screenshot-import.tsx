'use client';

import { useEffect, useRef, useState } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import { runOcrPipeline, type ProgressUpdate } from '../lib/ocr/pipeline';
import type { IdentifiedCard, PortraitHashTable } from '../lib/ocr/types';
import { terminateOcrWorker } from '../lib/ocr/tesseract';
import { ConfirmationGrid } from './confirmation-grid';

type Props = {
  champions: Champion[];
  portraitLibrary: PortraitHashTable;
  onImport: (states: ChampionState[]) => void;
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'queued'; files: File[] }
  | { kind: 'processing'; progress: ProgressUpdate[]; files: File[] }
  | { kind: 'review'; cards: IdentifiedCard[] }
  | { kind: 'error'; message: string };

/**
 * Screenshot import surface. Accepts one or more roster screenshots via
 * drag/drop, paste, or file picker. Runs them through the OCR pipeline
 * client-side (no upload), then shows the confirmation grid for review.
 *
 * On import, calls onImport with the confirmed champion states.
 */
export function ScreenshotImport({ champions, portraitLibrary, onImport }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const dropRef = useRef<HTMLDivElement>(null);

  // Clean up OCR worker on unmount to free the ~30MB Tesseract.js footprint
  useEffect(() => {
    return () => {
      void terminateOcrWorker();
    };
  }, []);

  // Whole-page paste handler — Ctrl+V anywhere on the page captures the
  // clipboard if it contains an image
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (phase.kind === 'processing') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        queueFiles(files);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [phase.kind]);

  function queueFiles(newFiles: File[]) {
    setPhase((prev) => {
      const existing = prev.kind === 'queued' ? prev.files : [];
      return { kind: 'queued', files: [...existing, ...newFiles] };
    });
  }

  function onFilePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) queueFiles(files);
    e.target.value = ''; // allow re-picking the same file
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (phase.kind === 'processing') return;
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) queueFiles(files);
  }

  function clearQueue() {
    setPhase({ kind: 'idle' });
  }

  async function runProcessing() {
    if (phase.kind !== 'queued') return;
    const files = phase.files;
    setPhase({ kind: 'processing', progress: [], files });
    try {
      const cards = await runOcrPipeline(files, {
        champions,
        portraitLibrary,
        onProgress: (update) => {
          setPhase((p) =>
            p.kind === 'processing'
              ? { ...p, progress: [...p.progress, update] }
              : p,
          );
        },
      });
      if (cards.length === 0) {
        setPhase({
          kind: 'error',
          message:
            'No champions could be identified. Make sure the screenshots are from the in-game prestige page or champion roster.',
        });
        return;
      }
      setPhase({ kind: 'review', cards });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Processing failed',
      });
    }
  }

  function onConfirm(states: ChampionState[]) {
    onImport(states);
    setPhase({ kind: 'idle' });
  }

  // ── Render ──

  if (phase.kind === 'review') {
    return (
      <ConfirmationGrid
        cards={phase.cards}
        champions={champions}
        onConfirm={onConfirm}
        onCancel={() => setPhase({ kind: 'idle' })}
      />
    );
  }

  if (phase.kind === 'processing') {
    const lastProgress = phase.progress[phase.progress.length - 1];
    const message = lastProgress?.copy ?? 'Opening a portal to the multiverse…';
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <div className="w-4 h-4 border-2 border-[var(--color-marvel-impact)] border-t-transparent rounded-full animate-spin" />
          <span>{message}</span>
        </div>
        <div className="text-xs text-[var(--color-ink-soft)]">
          Processing happens in your browser. Screenshots aren&apos;t uploaded
          anywhere. First-run downloads ~2MB of OCR data; subsequent screenshots
          process in 20–40 seconds.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <label className="block text-sm font-medium">
          Import from screenshot
        </label>
        <a
          href="#help"
          onClick={(e) => {
            e.preventDefault();
            alert(
              'Best results: screenshot the in-game prestige modal (Profile → Top 30 Prestige). The My Champions tab works too, but the layout is denser and accuracy is lower. Drop the file here, paste with Ctrl+V, or click to pick. You can paste multiple screenshots; duplicates are merged automatically.',
            );
          }}
          className="text-xs text-[var(--color-ink-soft)] underline hover:text-[var(--color-marvel-impact)]"
        >
          How does this work?
        </a>
      </div>

      <div
        ref={dropRef}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        className="border-2 border-dashed border-[var(--color-rule)] rounded-lg p-8 text-center bg-[var(--color-paper-soft)] hover:border-[var(--color-marvel-impact)] transition-colors"
      >
        <div className="text-sm text-[var(--color-ink-soft)] space-y-2">
          <p>
            <strong>Drop one or more screenshots</strong> here, or paste with{' '}
            <kbd className="px-1.5 py-0.5 bg-[var(--color-paper)] border border-[var(--color-rule)] rounded text-xs">
              Ctrl+V
            </kbd>{' '}
            anywhere on this page.
          </p>
          <p className="text-xs">
            Or{' '}
            <label className="underline hover:text-[var(--color-marvel-impact)] cursor-pointer">
              pick from file
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onFilePickerChange}
                className="hidden"
              />
            </label>
            . Works with screenshots from any device.
          </p>
        </div>
      </div>

      {phase.kind === 'queued' && (
        <div className="space-y-3">
          <div className="text-sm">
            <strong>{phase.files.length}</strong>{' '}
            {phase.files.length === 1 ? 'screenshot' : 'screenshots'} ready to
            process
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {phase.files.map((f, i) => (
              <ScreenshotThumb key={i} file={f} />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runProcessing}
              className="px-4 py-2 bg-[var(--color-marvel-impact)] text-[var(--color-paper)] font-medium rounded hover:bg-[var(--color-marvel-editorial)] transition-colors"
            >
              Process {phase.files.length}{' '}
              {phase.files.length === 1 ? 'screenshot' : 'screenshots'}
            </button>
            <button
              type="button"
              onClick={clearQueue}
              className="px-4 py-2 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)]"
            >
              Clear
            </button>
          </div>
          <div className="text-xs text-[var(--color-ink-soft)]">
            First run downloads Tesseract.js (~2MB). Each screenshot takes
            20–40 seconds — there are two OCR passes per screenshot
            (multiverse-wide anchor scan, then per-card BHR reads).
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="text-sm bg-amber-50 border border-amber-300 text-amber-900 rounded p-3">
          <strong>Couldn&apos;t process those screenshots.</strong>
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

function ScreenshotThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="border border-[var(--color-rule)] rounded overflow-hidden bg-[var(--color-paper)]">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={file.name}
          className="w-full h-24 object-cover"
        />
      )}
      <div className="text-[10px] text-[var(--color-ink-soft)] px-1 py-0.5 truncate">
        {file.name}
      </div>
    </div>
  );
}
