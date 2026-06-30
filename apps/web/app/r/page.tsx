'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { Champion, ChampionState } from '@prestige-tools/engine';
import {
  fetchShare,
  recordLocalShare,
  type SharedRosterPayload,
} from '../../lib/share-client';
import { loadActiveChampions } from '../../lib/data-loader';
import { saveRoster } from '../../lib/roster-storage';
import { trackEvent } from '../../lib/analytics';
import { SharedRosterView } from '../../components/shared-roster-view';

/**
 * Demo roster state assignment.
 *
 * Maps each champion deterministically (by id hash) onto a state distribution
 * roughly mirroring a developed mid-paragon roster, so the demo shows visual
 * variety across rank/sig/ascension levels without random output. Same
 * champion → same demo state every page load, which makes screenshots stable.
 *
 * Distribution:
 *   15%  R5 sig 200 A2 (ascended max — only if ascendable)
 *   25%  R5 sig 200 A1 (ascended mid — only if ascendable)
 *   25%  R5 sig 200 A0
 *   20%  R4 sig 200 A0
 *   15%  R3 sig 200 A0
 *
 * Non-ascendable champions roll forward to R5 sig 200 A0 if they land in
 * an A1/A2 bucket.
 */
function demoStateFor(c: Champion): ChampionState {
  let hash = 0;
  for (let i = 0; i < c.id.length; i++) {
    hash = (hash * 31 + c.id.charCodeAt(i)) & 0xffff;
  }
  const pct = hash % 100;

  // Helper: every demo entry is synthetic but presents as user-confirmed
  // manual entry. Provenance is honestly 'manual' since the entries are
  // hand-coded here, even if the values are mechanically derived.
  const make = (
    rank: 3 | 4 | 5 | 6,
    sig: number,
    ascension: 'A0' | 'A1' | 'A2',
  ): ChampionState => ({
    championId: c.id,
    rank,
    sig,
    ascension,
    stateConfirmed: true,
    addedVia: 'manual',
  });

  if (pct < 15 && c.ascendable) return make(5, 200, 'A2');
  if (pct < 40 && c.ascendable) return make(5, 200, 'A1');
  if (pct < 65) return make(5, 200, 'A0');
  if (pct < 85) return make(4, 200, 'A0');
  return make(3, 200, 'A0');
}

/**
 * Shared-roster page.
 *
 * URL shape:
 *   /r/?id=abc12345  — real shared roster, fetched from the KV-backed API
 *   /r/?demo=1       — showcase preview: every active champion at a varied
 *                      R3+ state. Useful for previewing the share view layout
 *                      with a large roster, or for screenshotting "what a
 *                      maxed-out roster looks like in mcoc.help".
 *
 * Search-param-based rather than path-segment-based because Next.js static
 * export doesn't generate dynamic segments without known params at build
 * time. Phase 2 could add a Cloudflare _redirects rule to support
 * /r/abc12345 → /r/?id=abc12345 if pretty URLs become important.
 */
function SharedRosterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams?.get('id');
  // Personal sync URL: when the owner generates a "sync to your other
  // devices" link, the deleteToken comes through as ?token=... so this
  // device can register itself as a writer on import. Untrusted senders
  // shouldn't be given this token — owner copies it for their own devices
  // only. The token is private; treat it like a password.
  const token = searchParams?.get('token');
  const isDemo = searchParams?.get('demo') === '1';

  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'loaded'; payload: SharedRosterPayload; demo?: boolean }
  >({ phase: 'loading' });

  // useMemo is important here — loadActiveChampions() returns a fresh array
  // reference every call, which would put `champions` in the useEffect deps
  // changing every render → infinite setState loop.
  const champions = useMemo(() => loadActiveChampions(), []);

  useEffect(() => {
    if (isDemo) {
      // Build a stress-test/showcase payload using every active champion in the
      // seed at a varied R3+ state. Assignment is deterministic (hash of
      // champion id) so the same demo looks the same every time — useful for
      // screenshots and layout verification with a large roster (~250 champs).
      const demoChampions: ChampionState[] = champions.map((c) => demoStateFor(c));
      const demoNow = new Date().toISOString();
      setState({
        phase: 'loaded',
        demo: true,
        payload: {
          label: `Demo · all ${demoChampions.length} 7★ champions at R3+`,
          champions: demoChampions,
          mode: 'snapshot',
          createdAt: demoNow,
          lastSyncedAt: demoNow,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString(),
        },
      });
      return;
    }
    if (!id) {
      setState({ phase: 'error', message: 'No share ID provided.' });
      return;
    }
    fetchShare(id)
      .then((payload) => setState({ phase: 'loaded', payload }))
      .catch((err) => setState({ phase: 'error', message: (err as Error).message }));
  }, [id, isDemo, champions]);

  // Live shares — silently re-fetch when the recipient brings the tab back
  // into focus so the "synced X ago" stays honest. Snapshots never change,
  // so skip the listener for them.
  useEffect(() => {
    if (state.phase !== 'loaded') return;
    if (state.demo) return;
    if (state.payload.mode !== 'live') return;
    if (!id) return;
    if (typeof window === 'undefined') return;

    const refetch = () => {
      if (document.visibilityState !== 'visible') return;
      fetchShare(id)
        .then((payload) =>
          setState((prev) =>
            prev.phase === 'loaded' && !prev.demo
              ? { ...prev, payload }
              : prev,
          ),
        )
        .catch(() => {
          // Silent — the stale view is still useful.
        });
    };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('focus', refetch);
    return () => {
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('focus', refetch);
    };
  }, [id, state]);

  function handleImport() {
    if (state.phase !== 'loaded') return;
    if (state.demo) {
      window.alert(
        "This is a demo preview — importing it would overwrite your roster with the synthetic demo states. If you want to do that anyway, build a roster manually via /roster/.",
      );
      return;
    }
    // If the URL carries a write token AND the share is live, this is the
    // owner's personal sync URL — set the device up as a writer so edits
    // here propagate back to the original device through the share.
    const wantsSync = Boolean(token) && id !== null && state.payload.mode === 'live';
    const confirmed = window.confirm(
      wantsSync
        ? `Import this roster AND keep this device in sync? Edits on either device will sync to the other through the shared link. Your current roster on this device will be replaced.`
        : 'Importing this roster will replace your current roster. Your existing roster will be lost. Continue?',
    );
    if (!confirmed) return;
    // Filter out any champions not in our current seed
    const knownIds = new Set(champions.map((c) => c.id));
    const validStates: ChampionState[] = state.payload.champions.filter((s) =>
      knownIds.has(s.championId),
    );
    saveRoster({ champions: validStates });
    if (wantsSync && id && token) {
      // Register this device as a writer; useLiveShareSync on /roster will
      // pick it up automatically.
      recordLocalShare({
        id,
        deleteToken: token,
        label: state.payload.label,
        mode: 'live',
        createdAt: state.payload.createdAt,
        lastSyncedAt: state.payload.lastSyncedAt,
        expiresAt: state.payload.expiresAt,
      });
    }
    if (validStates.length > 0) {
      trackEvent('roster_built', { method: wantsSync ? 'sync-url' : 'url' });
    }
    router.push('/roster/');
  }

  if (state.phase === 'loading') {
    return (
      <div className="py-12 text-center text-[var(--color-ink-soft)]">
        Loading shared roster…
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="space-y-4">
        <h1 className="editorial-heading text-3xl">Couldn&apos;t load shared roster</h1>
        <div className="p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900">
          {state.message}
        </div>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Shares expire after 6 months. Check the URL is correct, or ask whoever sent it
          to generate a fresh link.
        </p>
      </div>
    );
  }

  return (
    <>
      {state.demo && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-900">
          <strong>Demo preview.</strong> Every 7★ champion in the seed (
          {state.payload.champions.length}) at a varied R3+ state. Layout
          stress-test and showcase — the actual share feature (with a real
          /r/?id=… link) only works in production after deployment.
        </div>
      )}
      <SharedRosterView
        champions={champions}
        roster={state.payload.champions}
        label={state.payload.label}
        mode={state.payload.mode}
        lastSyncedAt={state.payload.lastSyncedAt}
        expiresAt={state.payload.expiresAt}
        syncMode={Boolean(token) && state.payload.mode === 'live' && !state.demo}
        onImport={handleImport}
      />
    </>
  );
}

export default function SharedRosterPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-[var(--color-ink-soft)]">Loading…</div>
      }
    >
      <SharedRosterPageInner />
    </Suspense>
  );
}
