'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';

export type SharedPoolPayload = {
  label: string | null;
  pool: string[];
  floor: { rank: Rank; ascension: Ascension };
  createdAt: string;
  expiresAt: string;
};

export type CreatePoolResponse = {
  id: string;
  deleteToken: string;
  expiresAt: string;
};

/**
 * POST a defender pool to the share API. Returns the share id and a
 * delete token. Same backend pattern as roster shares.
 */
export async function createSharedPool(
  pool: string[],
  floor: { rank: Rank; ascension: Ascension },
  label: string | null,
): Promise<CreatePoolResponse> {
  const res = await fetch('/api/share-pool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: label ?? undefined,
      pool,
      floor,
      website: '',
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error(
        "Sharing only works once deployed to Cloudflare Pages — the /api/share-pool endpoint isn't available in local dev.",
      );
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return await res.json();
}

export async function fetchSharedPool(id: string): Promise<SharedPoolPayload> {
  const res = await fetch(`/api/share-pool/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error(
        body.error ?? 'Shared pool not found or expired',
      );
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return await res.json();
}
