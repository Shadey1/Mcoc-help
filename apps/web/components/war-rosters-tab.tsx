'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WarBgs, WarPlayerInput } from '../lib/war-storage';
import { readSharedBgs, writeSharedBg, writeSharedBgs } from '../lib/war-bgs-shared';
import { fetchShare, type SharedRosterPayload } from '../lib/share-client';
import { fetchSharedBg, createSharedBg } from '../lib/share-bg-client';
import { WarShareInput, extractShareId, type WarShareRowStatus } from './war-share-input';

/**
 * BG rosters — the single source of truth for both the diversity tool
 * and the season planner. Editing here writes to the shared localStorage
 * key both tools hydrate from.
 *
 * Layout: 3 columns (BG1/BG2/BG3), each column has:
 *   - "Import from /war BG share" input at the top (paste an 8-char id
 *     to expand into 10 rows in one go)
 *   - 10 paste rows via <WarShareInput>
 *   - Per-row status: loading / loaded (name + champ count) / error
 *   - "Share this BG" button at the bottom (creates a /api/share-bg id
 *     the officer can paste into either tool)
 *
 * The status column re-renders as rosters load; nothing here writes to
 * either tool's own storage — that stays per-tool for tool-specific
 * settings (pool selection, floor, etc). We only own the roster rows.
 */

type BgIndex = 0 | 1 | 2;
const BG_LABELS: readonly [string, string, string] = ['BG1', 'BG2', 'BG3'];
const BG_INDICES: readonly BgIndex[] = [0, 1, 2];

type RowStatus = WarShareRowStatus;

export function WarRostersTab() {
  const [bgs, setBgs] = useState<WarBgs>([[], [], []]);
  const [statuses, setStatuses] = useState<[RowStatus[], RowStatus[], RowStatus[]]>([
    [], [], [],
  ]);
  const [importInput, setImportInput] = useState<[string, string, string]>(['', '', '']);
  const [importStatus, setImportStatus] = useState<[string, string, string]>(['', '', '']);
  const [shareStatus, setShareStatus] = useState<[string, string, string]>(['', '', '']);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from the shared store on first mount. Kick off a load for
  // every row that already has a share URL so the tool can show status
  // without the officer having to touch anything.
  useEffect(() => {
    const shared = readSharedBgs();
    if (shared) {
      setBgs(shared.bgs);
      shared.bgs.forEach((rows, bgIdx) => {
        rows.forEach((r, i) => {
          if (r.url.trim()) void loadRosterAt(bgIdx as BgIndex, i, r.url);
        });
      });
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatusAt = useCallback((bg: BgIndex, idx: number, s: RowStatus) => {
    setStatuses((prev) => {
      const next: [RowStatus[], RowStatus[], RowStatus[]] = [
        [...prev[0]!], [...prev[1]!], [...prev[2]!],
      ] as [RowStatus[], RowStatus[], RowStatus[]];
      const col = next[bg];
      while (col.length <= idx) col.push({ state: 'empty' });
      col[idx] = s;
      return next;
    });
  }, []);

  const loadRosterAt = useCallback(
    async (bg: BgIndex, idx: number, raw: string) => {
      const id = extractShareId(raw);
      if (!id) {
        setStatusAt(bg, idx, { state: 'empty' });
        return;
      }
      setStatusAt(bg, idx, { state: 'loading' });
      try {
        const payload: SharedRosterPayload = await fetchShare(id);
        setStatusAt(bg, idx, {
          state: 'loaded',
          label: payload.label,
          champCount: payload.champions.length,
          lastSyncedAt: payload.lastSyncedAt,
        });
      } catch (e) {
        setStatusAt(bg, idx, {
          state: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [setStatusAt],
  );

  /** Called every time the paste-list changes in a BG column. Writes
   *  through to the shared store immediately so a navigation away and
   *  back doesn't lose anything. Fires a load for any URL that arrived
   *  or changed. */
  const handleBgChange = useCallback(
    (bg: BgIndex, next: WarPlayerInput[]) => {
      setBgs((prev) => {
        const nextBgs: WarBgs = [...prev] as WarBgs;
        nextBgs[bg] = next;
        writeSharedBg(bg, next);
        return nextBgs;
      });
      next.forEach((r, i) => {
        const prior = bgs[bg]![i]?.url ?? '';
        if (r.url !== prior && r.url.trim()) {
          void loadRosterAt(bg, i, r.url);
        }
        if (!r.url.trim()) setStatusAt(bg, i, { state: 'empty' });
      });
    },
    [bgs, loadRosterAt, setStatusAt],
  );

  /** Import a whole BG bundle from a /api/share-bg id. Replaces that
   *  column's rows with what the bundle carries, up to 10. */
  const importBg = useCallback(
    async (bg: BgIndex) => {
      const raw = importInput[bg];
      const id = extractShareId(raw);
      if (!id) {
        setImportStatus((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = 'Not a share id.';
          return next;
        });
        return;
      }
      setImportStatus((prev) => {
        const next: [string, string, string] = [...prev] as [string, string, string];
        next[bg] = 'Loading…';
        return next;
      });
      try {
        const payload = await fetchSharedBg(id);
        const rows: WarPlayerInput[] = payload.rows
          .slice(0, 10)
          .map((r) => ({ url: r.url, name: r.name ?? '' }));
        handleBgChange(bg, rows);
        setImportStatus((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = `Loaded ${rows.length} rosters${payload.label ? ` from "${payload.label}"` : ''}.`;
          return next;
        });
        setImportInput((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = '';
          return next;
        });
      } catch (e) {
        setImportStatus((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = e instanceof Error ? e.message : String(e);
          return next;
        });
      }
    },
    [importInput, handleBgChange],
  );

  /** Share the current BG as a /api/share-bg id. Copies the resulting
   *  URL to the clipboard so the officer can post it. */
  const shareBg = useCallback(
    async (bg: BgIndex) => {
      const rows = bgs[bg]!.filter((r) => r.url.trim().length > 0);
      if (rows.length === 0) {
        setShareStatus((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = 'Add at least one roster first.';
          return next;
        });
        return;
      }
      setShareStatus((prev) => {
        const next: [string, string, string] = [...prev] as [string, string, string];
        next[bg] = 'Sharing…';
        return next;
      });
      try {
        const res = await createSharedBg(rows, { label: BG_LABELS[bg] });
        const url =
          typeof window !== 'undefined'
            ? `${window.location.origin}/war-rosters/?bg=${res.id}`
            : `/war-rosters/?bg=${res.id}`;
        try {
          await navigator.clipboard.writeText(url);
          setShareStatus((prev) => {
            const next: [string, string, string] = [...prev] as [string, string, string];
            next[bg] = `Shared. Link copied: id ${res.id}`;
            return next;
          });
        } catch {
          setShareStatus((prev) => {
            const next: [string, string, string] = [...prev] as [string, string, string];
            next[bg] = `Shared as ${res.id}. ${url}`;
            return next;
          });
        }
      } catch (e) {
        setShareStatus((prev) => {
          const next: [string, string, string] = [...prev] as [string, string, string];
          next[bg] = e instanceof Error ? e.message : String(e);
          return next;
        });
      }
    },
    [bgs],
  );

  const totalLoaded = useMemo(
    () =>
      statuses.reduce(
        (n, col) => n + col.filter((s) => s.state === 'loaded').length,
        0,
      ),
    [statuses],
  );

  /** URL param import: /war-rosters/?bg=<id>&into=<0|1|2> — the diversity
   *  tool's copy-BG-link workflow can deep-link here. Runs once after
   *  hydration so it doesn't fight the initial state load. */
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const bgId = params.get('bg');
    if (!bgId) return;
    const intoRaw = params.get('into');
    const into = intoRaw && ['0', '1', '2'].includes(intoRaw) ? (Number(intoRaw) as BgIndex) : 0;
    setImportInput((prev) => {
      const next: [string, string, string] = [...prev] as [string, string, string];
      next[into] = bgId;
      return next;
    });
    void importBg(into);
    // Clear the param so a refresh doesn't re-import.
    const url = new URL(window.location.href);
    url.searchParams.delete('bg');
    url.searchParams.delete('into');
    window.history.replaceState({}, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return (
    <section className="space-y-4">
      <p className="text-sm text-[var(--color-ink-soft)]">
        Set up your three battlegroups once. Both the Diversity and Planner
        tabs read from what you paste here.
        {totalLoaded > 0 && (
          <span className="ml-2 numeric">{totalLoaded} rosters loaded.</span>
        )}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {BG_INDICES.map((bg) => (
          <div
            key={bg}
            className="border border-[var(--color-rule)] rounded-lg bg-[var(--color-paper-card)] p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{BG_LABELS[bg]}</h3>
              <span className="text-xs text-[var(--color-ink-soft)] numeric">
                {statuses[bg]!.filter((s) => s.state === 'loaded').length} of 10
              </span>
            </div>

            {/* Import an existing BG bundle */}
            <div className="p-2 bg-[var(--color-paper-soft)] rounded space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-[var(--color-ink-soft)]">
                Import a BG share
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={importInput[bg]}
                  onChange={(e) =>
                    setImportInput((prev) => {
                      const next: [string, string, string] = [...prev] as [string, string, string];
                      next[bg] = e.target.value;
                      return next;
                    })
                  }
                  placeholder="BG share id"
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-[var(--color-rule)] rounded bg-[var(--color-paper)] focus:outline-none focus:border-[var(--color-marvel-impact)]"
                />
                <button
                  type="button"
                  onClick={() => void importBg(bg)}
                  disabled={!importInput[bg].trim()}
                  className="px-2 py-1 text-xs border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)] disabled:opacity-40"
                >
                  Load
                </button>
              </div>
              {importStatus[bg] && (
                <p
                  className={`text-xs ${
                    importStatus[bg].startsWith('Loaded')
                      ? 'text-[var(--color-ink-soft)]'
                      : importStatus[bg] === 'Loading…'
                        ? 'text-[var(--color-ink-soft)]'
                        : 'text-[var(--color-marvel-editorial)]'
                  }`}
                >
                  {importStatus[bg]}
                </p>
              )}
            </div>

            {/* Roster input */}
            <WarShareInput
              rows={bgs[bg]!}
              statuses={statuses[bg]!}
              onChange={(next) => handleBgChange(bg, next)}
            />

            {/* Share BG button */}
            <div className="pt-2 border-t border-[var(--color-rule)]">
              <button
                type="button"
                onClick={() => void shareBg(bg)}
                className="px-3 py-1.5 text-xs border border-[var(--color-rule)] rounded hover:border-[var(--color-marvel-impact)]"
              >
                Share this BG
              </button>
              {shareStatus[bg] && (
                <p className="text-xs text-[var(--color-ink-soft)] mt-1.5 break-all">
                  {shareStatus[bg]}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Silence unused import — writeSharedBgs is exposed for future
// bulk-import flows (e.g. paste 30 rows at once), not used here yet.
void writeSharedBgs;
