'use client';

import { useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
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
  setCapturing,
}: {
  result: WarResult;
  championLookup: Map<string, Champion>;
  slotsPerPlayer: number;
  bgLabel: string;
  printRef: RefObject<HTMLDivElement | null>;
  /** Toggle capture mode on the placement table — enlarges portraits, hides
   *  in-table state text + the unavailable-champs footer, promotes the
   *  mcoc.help wordmark so the PNG reads as a self-contained card. Wrapped
   *  in flushSync at call sites to force a synchronous re-render before
   *  html-to-image reads the DOM. */
  setCapturing: (v: boolean) => void;
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
    // flushSync forces the parent table to re-render into capture mode
    // BEFORE we hand the DOM to html-to-image; otherwise React would
    // batch the state update and we'd rasterise the pre-toggle layout.
    flushSync(() => setCapturing(true));
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
      flushSync(() => setCapturing(false));
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
 * Discord-friendly plain text: one line per player, "{name}: {champ}, ..."
 * No header row, no table, no code fence. The point is that Discord chat
 * columns are narrow — a pipe table needs to be wide enough to fit "Slot 5"
 * headers plus the longest name; a comma list wraps naturally at whatever
 * width the reader's chat pane happens to be. Missing slots (underfilled
 * players) render as "—" so the row still reads as five defenders.
 */
function formatAsMarkdown(
  result: WarResult,
  championLookup: Map<string, Champion>,
  slotsPerPlayer: number,
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

  const lines: string[] = [];
  for (const pid of playerIds) {
    const placements = byPlayer.get(pid) ?? [];
    const pname = nameByPlayer.get(pid) ?? pid;
    const champs: string[] = [];
    for (let i = 0; i < slotsPerPlayer; i++) {
      const a = placements[i];
      champs.push(a ? championLookup.get(a.championId)?.name ?? a.championId : '—');
    }
    lines.push(`${pname}: ${champs.join(', ')}`);
  }
  return lines.join('\n');
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
