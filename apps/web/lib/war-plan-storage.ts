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
