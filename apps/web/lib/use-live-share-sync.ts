'use client';

import { useEffect, useRef } from 'react';
import type { Roster } from '@prestige-tools/engine';
import {
  loadLiveLocalShares,
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

  useEffect(() => {
    latestRosterRef.current = roster;
  }, [roster]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;

    // Quick exit if the user hasn't recorded any live shares — most users.
    if (loadLiveLocalShares().length === 0) return;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void syncAllLiveShares(latestRosterRef.current.champions);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [roster, hydrated]);
}

async function syncAllLiveShares(
  champions: Roster['champions'],
): Promise<void> {
  // Re-read on fire so a share deleted mid-debounce isn't PUT.
  const live = loadLiveLocalShares();
  await Promise.allSettled(
    live.map(async (entry) => {
      try {
        const result = await updateShare(entry.id, entry.deleteToken, {
          champions,
        });
        touchLocalShareSync(entry.id, result.lastSyncedAt);
      } catch (err) {
        // Best-effort — next edit will retry. Log so it's visible during
        // dev but don't surface to the user.
        // eslint-disable-next-line no-console
        console.warn(`[live-share] sync failed for ${entry.id}:`, err);
      }
    }),
  );
}
