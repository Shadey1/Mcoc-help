'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';
import type { WarPlayerInput } from './war-storage';

export type SharedPoolPayload = {
  label: string | null;
  pool: string[];
  floor: { rank: Rank; ascension: Ascension };
  /** Optional — present on shares created after the BG bundling change. */
  bgs?: WarPlayerInput[][];
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
 * delete token. `bgs` is optional — pass it to bundle the three BG
 * roster-paste lists into the share alongside the pool + floor, so the
 * recipient gets the full war snapshot rather than just the defenders.
 */
export async function createSharedPool(
  pool: string[],
  floor: { rank: Rank; ascension: Ascension },
  label: string | null,
  bgs?: WarPlayerInput[][],
): Promise<CreatePoolResponse> {
  // Only ship BG groups that actually contain a URL — empty BG slots
  // shouldn't bloat the payload.
  const trimmedBgs = bgs?.map((group) =>
    group.filter((row) => row.url.trim().length > 0),
  );
  const includeBgs = trimmedBgs?.some((g) => g.length > 0);

  const res = await fetch('/api/share-pool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: label ?? undefined,
      pool,
      floor,
      ...(includeBgs ? { bgs: trimmedBgs } : {}),
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
