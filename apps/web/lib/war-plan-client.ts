'use client';

/**
 * Client wrappers around /api/share-plan/*.
 *
 * Four calls: create, fetch, update, delete. Update returns either a
 * new version or a "version conflict" object carrying the current
 * server-side payload — the UI decides whether to auto-reload, prompt
 * the officer, or refuse to overwrite.
 */

export type PlanPin = { championId: string; playerId: string | null };
export type PlanPlacement = {
  championId: string;
  playerId: string;
  pickRank: number;
  pinned: boolean;
};

export type PlanPayload = {
  bg: 1 | 2 | 3;
  season: number;
  pickOverrides: Record<string, string[]>;
  keyNodes: number[];
  pins: Record<string, PlanPin>;
  excludedPlayers: string[];
  strict: boolean;
  lastPlacement?: Record<string, PlanPlacement>;
  rosterShareIds: string[];
  playerNames?: Record<string, string>;
  label?: string;
};

export type StoredPlanPublic = PlanPayload & {
  label: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  version: number;
};

export type CreatePlanResponse = {
  id: string;
  deleteToken: string;
  expiresAt: string;
  version: number;
};

export type UpdatePlanResponse = {
  id: string;
  version: number;
  expiresAt: string;
};

export type UpdatePlanConflict = {
  conflict: true;
  currentVersion: number;
  currentPayload: StoredPlanPublic;
};

const IS_LOCAL_DEV_ERROR =
  "Sharing only works once deployed to Cloudflare Pages — the /api/share-plan endpoint isn't available in local dev.";

async function readErrorBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { error: `request failed (${res.status})` };
  }
}

export async function createSharedPlan(payload: PlanPayload): Promise<CreatePlanResponse> {
  const res = await fetch('/api/share-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, website: '' }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(IS_LOCAL_DEV_ERROR);
    const body = await readErrorBody(res);
    throw new Error((body.error as string) ?? `request failed (${res.status})`);
  }
  return (await res.json()) as CreatePlanResponse;
}

export async function fetchSharedPlan(id: string): Promise<StoredPlanPublic> {
  const res = await fetch(`/api/share-plan/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Plan not found. It may have expired (plans live 6 months).');
    const body = await readErrorBody(res);
    throw new Error((body.error as string) ?? `request failed (${res.status})`);
  }
  return (await res.json()) as StoredPlanPublic;
}

export async function updateSharedPlan(
  id: string,
  deleteToken: string,
  baseVersion: number,
  payload: PlanPayload,
): Promise<UpdatePlanResponse | UpdatePlanConflict> {
  const res = await fetch(`/api/share-plan/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deleteToken, baseVersion, payload }),
  });
  if (res.status === 409) {
    const body = (await readErrorBody(res)) as {
      currentVersion?: number;
      currentPayload?: StoredPlanPublic;
    };
    return {
      conflict: true,
      currentVersion: body.currentVersion ?? 0,
      currentPayload: body.currentPayload as StoredPlanPublic,
    };
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error(IS_LOCAL_DEV_ERROR);
    const body = await readErrorBody(res);
    throw new Error((body.error as string) ?? `request failed (${res.status})`);
  }
  return (await res.json()) as UpdatePlanResponse;
}

export async function deleteSharedPlan(id: string, deleteToken: string): Promise<void> {
  const res = await fetch(
    `/api/share-plan/${encodeURIComponent(id)}?token=${encodeURIComponent(deleteToken)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error((body.error as string) ?? `request failed (${res.status})`);
  }
}
