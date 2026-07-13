'use client';

import { useRef, useState, type RefObject } from 'react';
import type {
  Champion,
  WarAssignment,
  WarResult,
} from '@prestige-tools/engine';

/**
 * Two-button export row: copies the placements to the clipboard either as a
 * Discord-friendly Markdown code-block (text) or as a PNG rendered from the
 * on-screen placement region (image, with portraits + tier badges baked in).
 *
 * PNG capture uses `html-to-image` (dynamic import so it doesn't bloat other
 * routes) against the DOM node passed via `printRef` — typically the wrapping
 * div around the placements table + mcoc.help footer. Falls back to a file
 * download when `navigator.clipboard.write` isn't available or is blocked by
 * the browser's clipboard permission model.
 */
export function WarPlacementExport({
  result,
  championLookup,
  slotsPerPlayer,
  bgLabel,
  printRef,
}: {
  result: WarResult;
  championLookup: Map<string, Champion>;
  slotsPerPlayer: number;
  bgLabel: string;
  printRef: RefObject<HTMLDivElement | null>;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<'text' | 'image' | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  async function copyAsText() {
    setBusy('text');
    try {
      const markdown = formatAsMarkdown(
        result,
        championLookup,
        slotsPerPlayer,
        bgLabel,
      );
      await navigator.clipboard.writeText(markdown);
      flashToast('Copied as text · paste into Discord');
    } catch {
      flashToast('Copy blocked by browser — try the image button instead');
    } finally {
      setBusy(null);
    }
  }

  async function copyAsImage() {
    const node = printRef.current;
    if (!node) return;
    setBusy('image');
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: getComputedBackground(node),
      });
      if (!blob) throw new Error('Render produced no image');
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        flashToast('Copied as image · paste into Discord');
      } catch {
        // Clipboard image write blocked (Safari, permission denied, etc).
        // Download the PNG instead — same content, different delivery.
        downloadBlob(blob, `${bgLabel.toLowerCase()}-placements.png`);
        flashToast('Image saved as download — clipboard image not supported');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Render failed';
      flashToast(`Couldn't build image: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copyAsText()}
        disabled={busy !== null}
        className="text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors disabled:opacity-50 disabled:cursor-wait"
        title="Copy a Markdown table — pastes cleanly into Discord as a code block"
      >
        {busy === 'text' ? 'Copying…' : 'Copy as text'}
      </button>
      <button
        type="button"
        onClick={() => void copyAsImage()}
        disabled={busy !== null}
        className="text-xs px-3 py-1.5 border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors disabled:opacity-50 disabled:cursor-wait"
        title="Copy a PNG with portraits — pastes into Discord as an inline image"
      >
        {busy === 'image' ? 'Rendering…' : 'Copy as image'}
      </button>
      {toast && (
        <span className="text-xs text-[var(--color-marvel-editorial)] italic">
          {toast}
        </span>
      )}
    </div>
  );
}

/**
 * Discord-friendly Markdown code-block: fixed-width pipe table so the rows
 * line up regardless of monospace font. Player column is truncated to 14
 * chars; slot columns include the champion name + rank/asc/sig — no
 * portraits or tier badges (that's what "Copy as image" is for).
 *
 * Wrapping in ``` keeps Discord from mangling the pipe characters as
 * quote-syntax or applying markdown italics to `*`-containing champion names.
 */
function formatAsMarkdown(
  result: WarResult,
  championLookup: Map<string, Champion>,
  slotsPerPlayer: number,
  bgLabel: string,
): string {
  // Group assignments by player, preserving engine's within-player sort.
  const byPlayer = new Map<string, WarAssignment[]>();
  const nameByPlayer = new Map<string, string>();
  for (const a of result.assignments) {
    const list = byPlayer.get(a.playerId) ?? [];
    list.push(a);
    byPlayer.set(a.playerId, list);
    nameByPlayer.set(a.playerId, a.playerName);
  }
  for (const u of result.underfilled) {
    if (!byPlayer.has(u.playerId)) {
      byPlayer.set(u.playerId, []);
      nameByPlayer.set(u.playerId, u.playerName);
    }
  }

  // Row order matches the on-screen table: top placement desc.
  const playerIds = [...byPlayer.keys()].sort((a, b) => {
    const at = byPlayer.get(a)?.[0];
    const bt = byPlayer.get(b)?.[0];
    const as = at ? at.rank * 10 + (at.ascension === 'A2' ? 2 : at.ascension === 'A1' ? 1 : 0) : -1;
    const bs = bt ? bt.rank * 10 + (bt.ascension === 'A2' ? 2 : bt.ascension === 'A1' ? 1 : 0) : -1;
    if (as !== bs) return bs - as;
    return (nameByPlayer.get(a) ?? a).localeCompare(nameByPlayer.get(b) ?? b);
  });

  const header = ['Player', ...Array.from({ length: slotsPerPlayer }, (_, i) => `Slot ${i + 1}`)];
  const rows: string[][] = [];
  for (const pid of playerIds) {
    const placements = byPlayer.get(pid) ?? [];
    const cells: string[] = [truncate(nameByPlayer.get(pid) ?? pid, 14)];
    for (let i = 0; i < slotsPerPlayer; i++) {
      const a = placements[i];
      if (!a) {
        cells.push('—');
        continue;
      }
      const name = championLookup.get(a.championId)?.name ?? a.championId;
      const sigSuffix = a.sig > 0 ? ` s${a.sig}` : '';
      cells.push(`${name} R${a.rank}${a.ascension}${sigSuffix}`);
    }
    rows.push(cells);
  }

  // Column widths for aligned monospace rendering in Discord.
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const pad = (cell: string, i: number) => cell.padEnd(widths[i] ?? 0, ' ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');

  const lines = [
    `${bgLabel} placements — mcoc.help`,
    '```',
    header.map(pad).join(' | '),
    sep,
    ...rows.map((r) => r.map(pad).join(' | ')),
    '```',
  ];
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Best-effort match of the node's background so the PNG doesn't render on a
 * transparent canvas. Falls back to white when computed style is transparent
 * — the war page's card sits on --color-paper-card, which resolves to a
 * real colour in both themes.
 */
function getComputedBackground(node: HTMLElement): string {
  let el: HTMLElement | null = node;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    el = el.parentElement;
  }
  return '#ffffff';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
