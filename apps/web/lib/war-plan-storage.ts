'use client';

import type { PlanPayload, StoredPlanPublic } from './war-plan-client';

/**
 * localStorage cache for shared plans.
 *
 * Two purposes:
 *   1. Survive a flaky connection — a plan the officer just fetched is
 *      re-served instantly on next open, then refreshed from the API.
 *   2. Keep an officer's own edit token (a plan they created) alongside
 *      the plan id, so the "Save" affordance is available on return.
 *
 * Storage layout (per share id):
 *   war-plan:<id>        → { payload, version, updatedAt, cachedAt }
 *   war-plan-token:<id>  → { deleteToken, savedAt }   [only if creator]
 *
 * Everything is per-browser. No cross-device sync — the share link is
 * the cross-device transport. All accessors wrap try/catch because
 * private windows / cleared site data can throw.
 */

type CachedPlan = {
  payload: PlanPayload;
  version: number;
  updatedAt: string;
  cachedAt: string;
};

const PLAN_KEY = (id: string): string => `war-plan:${id}`;
const TOKEN_KEY = (id: string): string => `war-plan-token:${id}`;
/** Draft plan state, per-BG. Lets a page refresh not wipe unsaved edits. */
const DRAFT_KEY = (bg: 1 | 2 | 3): string => `war-plan-draft:${bg}`;

export function cachePlan(id: string, stored: StoredPlanPublic): void {
  const { createdAt: _c, expiresAt: _e, label, ...rest } = stored;
  void _c;
  void _e;
  const payload: PlanPayload = { ...rest, label: label ?? undefined };
  const entry: CachedPlan = {
    payload,
    version: stored.version,
    updatedAt: stored.updatedAt,
    cachedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(PLAN_KEY(id), JSON.stringify(entry));
  } catch {
    // Quota / private-mode / disabled — silently drop.
  }
}

export function readCachedPlan(id: string): CachedPlan | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY(id));
    if (!raw) return null;
    return JSON.parse(raw) as CachedPlan;
  } catch {
    return null;
  }
}

export function clearCachedPlan(id: string): void {
  try {
    localStorage.removeItem(PLAN_KEY(id));
  } catch {
    // ignore
  }
}

export function saveDeleteToken(id: string, deleteToken: string): void {
  try {
    localStorage.setItem(
      TOKEN_KEY(id),
      JSON.stringify({ deleteToken, savedAt: new Date().toISOString() }),
    );
  } catch {
    // ignore
  }
}

export function readDeleteToken(id: string): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { deleteToken?: string };
    return typeof parsed.deleteToken === 'string' ? parsed.deleteToken : null;
  } catch {
    return null;
  }
}

export function clearDeleteToken(id: string): void {
  try {
    localStorage.removeItem(TOKEN_KEY(id));
  } catch {
    // ignore
  }
}

// ── Per-BG plan drafts ──────────────────────────────────────────────────
// Distinct from the by-id cache above — this is "here's the current
// planner state I was editing" so a refresh doesn't wipe unsaved work.
// One entry per BG so switching BGs during an edit session doesn't
// clobber the others.

export function readDraftPlan(bg: 1 | 2 | 3): PlanPayload | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(bg));
    if (!raw) return null;
    return JSON.parse(raw) as PlanPayload;
  } catch {
    return null;
  }
}

export function writeDraftPlan(bg: 1 | 2 | 3, payload: PlanPayload): void {
  try {
    localStorage.setItem(DRAFT_KEY(bg), JSON.stringify(payload));
  } catch {
    // Quota / private-mode — silently drop.
  }
}

export function clearDraftPlan(bg: 1 | 2 | 3): void {
  try {
    localStorage.removeItem(DRAFT_KEY(bg));
  } catch {
    // ignore
  }
}
