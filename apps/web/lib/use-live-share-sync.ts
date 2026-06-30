'use client';

import { useEffect, useRef } from 'react';
import type { Roster } from '@prestige-tools/engine';
import {
  loadLiveLocalShares,
  markLocalEdit,
  touchLocalShareSync,
  updateShare,
} from './share-client';

/**
 * Debounced auto-sync for live roster shares.
 *
 * When the owner edits their roster, this hook waits for the edits to
 * settle (DEBOUNCE_MS) then PUTs the latest roster to every live share
 * the owner has recorded in localStorage. Snapshot shares are ignored —
 * they stay frozen at creation.
 *
 * Silent by design: no toast, no spinner. The freshness signal lives on
 * the recipient side ("Live · synced 4m ago"). Owners just edit and trust
 * the loop. Failures are logged and re-attempted on the next edit; the
 * server's per-IP rate limit (120/hr) is well above any human edit rate
 * given the debounce.
 *
 * Skip cases:
 *   - hydrated=false (don't sync the empty default-state from mount)
 *   - no live shares saved locally (the common case for non-officer users)
 *   - SSR (no `window`)
 */
const DEBOUNCE_MS = 10_000;

export function useLiveShareSync(roster: Roster, hydrated: boolean): void {
  const timerRef = useRef<number | null>(null);
  // Track the roster snapshot we'll PUT — captured at the time the timer
  // fires, not at scheduling time, so the latest state wins.
  const latestRosterRef = useRef<Roster>(roster);
  // JSON of the last roster we successfully PUT. Used to skip no-op PUTs
  // when an inbound pull (useInboundShareSync) sets local roster to what
  // the server already has — without this, the resulting React re-render
  // would schedule a redundant PUT and the two devices would ping-pong.
  const lastPushedJSONRef = useRef<string | null>(null);

  useEffect(() => {
    latestRosterRef.current = roster;
  }, [roster]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;

    // Stamp this device's "last local edit" so the inbound-sync hook on
    // any sibling device knows whether a pull-on-focus is safe. Stamped
    // even if no live share exists yet — the user may create one later
    // and we want the timestamp accurate from the first edit forward.
    markLocalEdit();

    // Quick exit if the user hasn't recorded any live shares — most users.
    if (loadLiveLocalShares().length === 0) return;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void syncAllLiveShares(latestRosterRef.current.champions, lastPushedJSONRef);
    }, DEBOUNCE_MS);
    // No cleanup here — re-renders due to roster changes overwrite
    // timerRef explicitly above. We deliberately don't tear the timer
    // down on every effect run because the unmount-flush effect below
    // needs it to survive long enough to fire.
  }, [roster, hydrated]);

  // Unmount-only flush. If the user edits their roster and navigates
  // away (e.g. to /war) before the debounce window expires, fire the
  // pending PUT synchronously instead of dropping it — otherwise the
  // server stays stale and recipients see "synced N days ago" even
  // though the owner just saved. Empty deps so this only runs on
  // mount/unmount, not on each roster change.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        void syncAllLiveShares(latestRosterRef.current.champions, lastPushedJSONRef);
      }
    };
  }, []);
}

async function syncAllLiveShares(
  champions: Roster['champions'],
  lastPushedJSONRef: { current: string | null },
): Promise<void> {
  const json = JSON.stringify(champions);
  // Skip the PUT entirely if nothing changed since our last successful
  // sync — typical after an inbound pull echoed the server state back
  // through React state.
  if (json === lastPushedJSONRef.current) return;
  // Re-read on fire so a share deleted mid-debounce isn't PUT.
  const live = loadLiveLocalShares();
  if (live.length === 0) return;
  await Promise.allSettled(
    live.map(async (entry) => {
      try {
        const result = await updateShare(entry.id, entry.deleteToken, {
          champions,
        });
        touchLocalShareSync(entry.id, result.lastSyncedAt);
        lastPushedJSONRef.current = json;
      } catch (err) {
        // Best-effort — next edit will retry. Log so it's visible during
        // dev but don't surface to the user.
        // eslint-disable-next-line no-console
        console.warn(`[live-share] sync failed for ${entry.id}:`, err);
      }
    }),
  );
}
