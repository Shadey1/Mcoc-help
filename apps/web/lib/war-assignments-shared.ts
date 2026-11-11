'use client';

import type { WarAssignments } from './war-storage';

/**
 * Diversity assignments bridge — what the diversity tool decided each
 * player places, handed to the season planner on the same device.
 *
 * Storage layout (localStorage):
 *   mcoc-help-war-assignments-shared → { bgs: [a, a, a], updatedAt }
 *
 * Each BG entry maps a roster share id (the planner's player id) to the
 * champion ids the diversity tool assigned that player, after any manual
 * swaps. The diversity tool writes a BG whenever it has a result for it;
 * a BG with no result keeps its last entry, so clearing rows on the
 * Diversity page does not wipe a plan already in progress.
 *
 * Every accessor is try/catch-wrapped: private windows and blocked
 * storage can throw.
 */

const STORAGE_KEY = 'mcoc-help-war-assignments-shared';

export type SharedAssignments = {
  bgs: [WarAssignments, WarAssignments, WarAssignments];
  updatedAt: string;
};

export function readSharedAssignments(): SharedAssignments | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SharedAssignments;
    if (!Array.isArray(parsed.bgs) || parsed.bgs.length !== 3) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSharedAssignments(bgIndex: 0 | 1 | 2, assignments: WarAssignments): void {
  try {
    const current = readSharedAssignments()?.bgs ?? [{}, {}, {}];
    const next = [...current] as SharedAssignments['bgs'];
    next[bgIndex] = assignments;
    const payload: SharedAssignments = { bgs: next, updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or disabled: the planner falls back to the pool.
  }
}

/** Number of players with at least one assigned champion. */
export function assignedPlayerCount(assignments: WarAssignments): number {
  return Object.values(assignments).filter((ids) => ids.length > 0).length;
}
