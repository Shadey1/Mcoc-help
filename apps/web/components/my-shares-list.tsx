'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  deleteShare,
  forgetLocalShare,
  loadLocalShares,
  updateShare,
  type LocalShareEntry,
  type ShareMode,
} from '../lib/share-client';

/**
 * Client-only shares manager. Reads directly from localStorage on
 * mount and after each action. Each row exposes the two URLs (view
 * + sync), a delete confirm, and — for snapshots — a convert-to-live
 * button that PUTs mode=live so the share becomes editable by any
 * writer device.
 *
 * The row's "last synced" clock is derived from LocalShareEntry.
 * lastSyncedAt (which the auto-sync loop updates on every successful
 * PUT). "Never" appears for live shares whose owner hasn't edited
 * since creation on this device.
 */
export function MySharesList() {
  const [shares, setShares] = useState<LocalShareEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShares(loadLocalShares());
    setHydrated(true);
  }, []);

  function refresh() {
    setShares(loadLocalShares());
  }

  async function handleDelete(entry: LocalShareEntry) {
    if (
      !window.confirm(
        `Delete this share permanently? Anyone with the URL will get a 404. This can't be undone.`,
      )
    )
      return;
    setBusyId(entry.id);
    setError(null);
    try {
      await deleteShare(entry.id, entry.deleteToken);
    } catch (err) {
      // The server may be gone or the share may have expired — either
      // way, forget it locally so it stops cluttering the list.
      // eslint-disable-next-line no-console
      console.warn('[shares] server delete failed, removing local record:', err);
    }
    forgetLocalShare(entry.id);
    refresh();
    setBusyId(null);
  }

  async function handleConvertToLive(entry: LocalShareEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const result = await updateShare(entry.id, entry.deleteToken, {
        mode: 'live',
      });
      // Rewrite the local record with the new mode + freshest sync stamp.
      const updated: LocalShareEntry = {
        ...entry,
        mode: 'live',
        lastSyncedAt: result.lastSyncedAt,
      };
      const rest = loadLocalShares().filter((e) => e.id !== entry.id);
      window.localStorage.setItem(
        'prestige-tools:my-shares',
        JSON.stringify([updated, ...rest]),
      );
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusyId(null);
  }

  if (!hydrated) {
    return (
      <div className="text-sm text-[var(--color-ink-soft)] italic">
        Loading your shares…
      </div>
    );
  }

  if (shares.length === 0) {
    return (
      <div className="p-6 border border-dashed border-[var(--color-rule)] rounded-md text-sm text-[var(--color-ink-soft)] text-center">
        No shares yet. Generate one from the{' '}
        <Link
          href="/roster/"
          className="underline hover:text-[var(--color-marvel-impact)]"
        >
          Roster page
        </Link>{' '}
        — it&apos;ll appear here for later management.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
          {error}
        </div>
      )}
      {shares.map((s) => (
        <ShareRow
          key={s.id}
          entry={s}
          busy={busyId === s.id}
          onDelete={() => handleDelete(s)}
          onConvertToLive={() => handleConvertToLive(s)}
        />
      ))}
    </div>
  );
}

type ShareRowProps = {
  entry: LocalShareEntry;
  busy: boolean;
  onDelete: () => void;
  onConvertToLive: () => void;
};

function ShareRow({ entry, busy, onDelete, onConvertToLive }: ShareRowProps) {
  const [copied, setCopied] = useState<null | 'view' | 'sync'>(null);
  const mode: ShareMode = entry.mode ?? 'snapshot';
  const viewUrl = `${window.location.origin}/r/?id=${entry.id}`;
  const syncUrl = `${window.location.origin}/r/?id=${entry.id}&token=${entry.deleteToken}`;

  async function copy(url: string, which: 'view' | 'sync') {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Silent — clipboard is best-effort.
    }
  }

  return (
    <div className="border border-[var(--color-rule)] bg-[var(--color-paper-card)] rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium">
            {entry.label ?? <em className="text-[var(--color-ink-soft)]">(no label)</em>}
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded ${
              mode === 'live'
                ? 'bg-[var(--color-marvel-impact)] text-[var(--color-paper)]'
                : 'bg-[var(--color-paper-soft)] text-[var(--color-ink-soft)] border border-[var(--color-rule)]'
            }`}
          >
            {mode}
          </span>
        </div>
        <div className="font-mono text-[10px] text-[var(--color-ink-soft)] numeric">
          created {formatDateShort(entry.createdAt)}
          {mode === 'live' && entry.lastSyncedAt && (
            <> · synced {formatRelative(entry.lastSyncedAt)}</>
          )}
          {' · expires '}
          {formatDateShort(entry.expiresAt)}
        </div>
      </div>

      <div className="space-y-2">
        <UrlRow
          id={`view-${entry.id}`}
          label="View URL"
          url={viewUrl}
          copied={copied === 'view'}
          onCopy={() => copy(viewUrl, 'view')}
        />
        {mode === 'live' && (
          <UrlRow
            id={`sync-${entry.id}`}
            label="Sync URL"
            url={syncUrl}
            copied={copied === 'sync'}
            onCopy={() => copy(syncUrl, 'sync')}
            hint="Private — only open on your own devices"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {mode === 'snapshot' && (
          <button
            type="button"
            onClick={onConvertToLive}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-[var(--color-marvel-impact)]/40 text-[var(--color-marvel-impact)] rounded hover:bg-[var(--color-marvel-impact)]/10 transition-colors disabled:opacity-50"
          >
            Convert to live share
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="px-3 py-1.5 text-xs border border-[var(--color-rule)] rounded hover:border-red-400 hover:text-red-600 transition-colors disabled:opacity-50 ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

type UrlRowProps = {
  id: string;
  label: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  hint?: string;
};

function UrlRow({ id, label, url, copied, onCopy, hint }: UrlRowProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label
          htmlFor={id}
          className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-ink-soft)]"
        >
          {label}
        </label>
        {hint && (
          <span className="text-[10px] text-[var(--color-ink-soft)] italic">
            {hint}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={url}
          readOnly
          onFocus={(e) => e.target.select()}
          className="flex-1 px-2 py-1.5 border border-[var(--color-rule)] rounded bg-[var(--color-paper-soft)] numeric text-xs"
        />
        <button
          type="button"
          onClick={onCopy}
          className="px-3 py-1.5 text-xs border border-[var(--color-rule)] rounded hover:bg-[var(--color-paper-soft)] transition-colors min-w-[60px]"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  if (diff < 0) return 'in the future';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
