'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ChampionState, Roster } from '@prestige-tools/engine';
import {
  fetchShare,
  getLocalEditAt,
  loadLiveLocalShares,
  touchLocalShareSync,
} from './share-client';
import { loadRoster, saveRoster } from './roster-storage';

/**
 * Inbound counterpart to [[useLiveShareSync]].
 *
 * When this device is a writer for a live share (i.e. the user opened a
 * personal sync URL with ?id=...&token=... and chose Import & Sync), the
 * other device's PUTs land on the server but this device has no way of
 * knowing until something pulls. This hook does that pull on mount and
 * on focus/visibility-change.
 *
 * Conflict rule (v1): pull only when this device has no unsynced local
 * edits — specifically when `serverLastSyncedAt > localShareLastSyncedAt`
 * (server has newer data than we last touched it with) AND
 * `serverLastSyncedAt > localEditAt` (we haven't edited since the server
 * version was written, so pulling won't clobber an in-flight local edit).
 *
 * If both sides have edits since the last sync point, we skip the pull
 * and let useLiveShareSync's debounced PUT win — last writer to PUT wins,
 * documented in the share-modal copy.
 *
 * Skip cases:
 *   - hydrated=false (don't fight the mount-time loadRoster)
 *   - no live shares saved locally
 *   - SSR
 */
export function useInboundShareSync(
  applyRoster: (roster: Roster) => void,
  hydrated: boolean,
): void {
  // Latest applyRoster + hydrated, read at fire time so the focus
  // listener never closes over stale state.
  const applyRosterRef = useRef(applyRoster);
  const hydratedRef = useRef(hydrated);
  useEffect(() => {
    applyRosterRef.current = applyRoster;
  }, [applyRoster]);
  useEffect(() => {
    hydratedRef.current = hydrated;
  }, [hydrated]);

  const pull = useCallback(async () => {
    if (!hydratedRef.current) return;
    if (typeof window === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    const writers = loadLiveLocalShares();
    if (writers.length === 0) return;

    const localEditAt = getLocalEditAt();

    for (const entry of writers) {
      try {
        const payload = await fetchShare(entry.id);
        const serverSyncedAt = payload.lastSyncedAt;
        const localSyncedAt = entry.lastSyncedAt ?? entry.createdAt;

        // Both conditions must hold or we skip:
        //  - server has newer data than we've seen
        //  - we have no unsynced local edits past that server timestamp
        if (serverSyncedAt <= localSyncedAt) continue;
        if (serverSyncedAt <= localEditAt) continue;

        // Skip when the server payload already matches what's on disk —
        // happens when both devices pulled the same state recently.
        // Avoids the no-op React re-render that would otherwise schedule
        // (and now skip, via the JSON-equality guard in useLiveShareSync)
        // a redundant PUT round-trip.
        const incomingChampions = payload.champions as ChampionState[];
        const existing = loadRoster().champions;
        if (JSON.stringify(existing) === JSON.stringify(incomingChampions)) {
          touchLocalShareSync(entry.id, serverSyncedAt);
          continue;
        }

        // Safe to pull. Apply to React state AND write through to
        // localStorage so a tab reload picks it up immediately even if
        // the inbound hook hasn't run yet.
        const next: Roster = { champions: incomingChampions };
        applyRosterRef.current(next);
        saveRoster(next);
        touchLocalShareSync(entry.id, serverSyncedAt);
      } catch (err) {
        // Best-effort; silent. Next focus retries.
        // eslint-disable-next-line no-console
        console.warn(`[inbound-share] pull failed for ${entry.id}:`, err);
      }
    }
  }, []);

  // Initial pull after hydration + listen for focus/visibility events.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;
    if (loadLiveLocalShares().length === 0) return;

    void pull();

    const onFocus = () => void pull();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hydrated, pull]);
}
