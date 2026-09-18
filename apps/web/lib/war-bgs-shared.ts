'use client';

import type { WarBgs, WarPlayerInput } from './war-storage';

/**
 * Shared BG rosters bridge — the single source of truth both the
 * diversity tool and the season planner hydrate from.
 *
 * Storage layout (localStorage):
 *   mcoc-help-war-bgs-shared → { bgs: WarBgs, updatedAt: string }
 *
 * The diversity tool's own `mcoc-help-war-v2` config stays in place as
 * a per-tool cache (pool selection, floor, alliance name, run history);
 * only the BG rosters cross-tool via this shared key. Same shape as
 * WarBgs so no adapter needed.
 *
 * Every accessor is try/catch-wrapped — private windows, Safari's
 * `Prevent Cross-Site Tracking` and clearing storage can all throw.
 */

const STORAGE_KEY = 'mcoc-help-war-bgs-shared';

export type SharedBgs = {
  bgs: WarBgs;
  updatedAt: string;
};

function emptyBgs(): WarBgs {
  return [[], [], []];
}

export function readSharedBgs(): SharedBgs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SharedBgs;
    if (!parsed.bgs || !Array.isArray(parsed.bgs) || parsed.bgs.length !== 3) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSharedBgs(bgs: WarBgs): void {
  try {
    const payload: SharedBgs = {
      bgs,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full / disabled — the tool falls back to per-tool state.
  }
}

export function writeSharedBg(bgIndex: 0 | 1 | 2, rows: WarPlayerInput[]): void {
  const current = readSharedBgs()?.bgs ?? emptyBgs();
  const next: WarBgs = [...current] as WarBgs;
  next[bgIndex] = rows;
  writeSharedBgs(next);
}

// ── BG-share delete tokens ─────────────────────────────────────────────
// A BG share (from /api/share-bg) hands back an 8-char id + 16-char
// deleteToken. Officers who shared a BG keep the token in their browser
// so they can revoke the share later. Same pattern the plan share uses.

const BG_TOKEN_KEY = (id: string): string => `war-bg-token:${id}`;

export function saveBgDeleteToken(id: string, deleteToken: string): void {
  try {
    localStorage.setItem(BG_TOKEN_KEY(id), deleteToken);
  } catch {
    // ignore
  }
}

export function readBgDeleteToken(id: string): string | null {
  try {
    return localStorage.getItem(BG_TOKEN_KEY(id));
  } catch {
    return null;
  }
}

export function clearBgDeleteToken(id: string): void {
  try {
    localStorage.removeItem(BG_TOKEN_KEY(id));
  } catch {
    // ignore
  }
}

// Track the most-recently-shared BG id per BG index, so the Revoke
// button survives a refresh. The id + token pair is what's needed to
// call DELETE; both are per-browser.
const LAST_SHARED_KEY = (bg: 0 | 1 | 2): string => `war-bg-last-shared:${bg}`;

export function writeLastSharedBgId(bg: 0 | 1 | 2, id: string): void {
  try {
    localStorage.setItem(LAST_SHARED_KEY(bg), id);
  } catch {
    // ignore
  }
}

export function readLastSharedBgId(bg: 0 | 1 | 2): string | null {
  try {
    return localStorage.getItem(LAST_SHARED_KEY(bg));
  } catch {
    return null;
  }
}

export function clearLastSharedBgId(bg: 0 | 1 | 2): void {
  try {
    localStorage.removeItem(LAST_SHARED_KEY(bg));
  } catch {
    // ignore
  }
}

/** Extract the 8-char share IDs from one BG's roster rows, in slot order.
 *  Empty / malformed rows produce empty strings — the planner needs the
 *  positional array to keep player-index stable. */
export function shareIdsFromBg(rows: WarPlayerInput[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const m = r.url.trim().match(/([A-Za-z0-9]{8})(?:$|[^A-Za-z0-9])/);
    out.push(m ? m[1]! : '');
  }
  return out;
}
