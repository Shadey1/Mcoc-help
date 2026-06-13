'use client';

import type { Ascension, Rank } from '@prestige-tools/engine';
import type { WarPlayerInput, WarPool } from './war-storage';

export type SharedBgPayload = {
  label: string | null;
  rows: WarPlayerInput[];
  /** Optional — present when the share bundles the defender pool. */
  pool?: WarPool;
  floor?: { rank: Rank; ascension: Ascension };
  createdAt: string;
  expiresAt: string;
};

export type CreateBgResponse = {
  id: string;
  deleteToken: string;
  expiresAt: string;
};

/**
 * POST a single BG's roster-paste list to the share API. Returns the
 * short 8-char id and a delete token. The id round-trips into the URL
 * as /war/?bg=<id>, which is dramatically shorter than the inline
 * base64 payload it replaces.
 *
 * Pool + floor are bundled into the same blob so the recipient gets
 * a complete war snapshot, not just BG roster URLs. Both must be
 * provided together — passing only one is a server-side error.
 */
export async function createSharedBg(
  rows: WarPlayerInput[],
  options?: {
    label?: string;
    pool?: WarPool;
    floor?: { rank: Rank; ascension: Ascension };
  },
): Promise<CreateBgResponse> {
  const trimmed = rows.filter((r) => r.url.trim().length > 0);
  if (trimmed.length === 0) {
    throw new Error('No rows to share — add at least one share URL.');
  }

  const poolTotal = options?.pool
    ? options.pool.strong.length +
      options.pool.mid.length +
      options.pool.base.length
    : 0;
  const includePool = poolTotal > 0 && !!options?.floor;

  const res = await fetch('/api/share-bg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rows: trimmed,
      ...(options?.label ? { label: options.label } : {}),
      ...(includePool ? { pool: options!.pool, floor: options!.floor } : {}),
      website: '',
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error(
        "Sharing only works once deployed to Cloudflare Pages — the /api/share-bg endpoint isn't available in local dev.",
      );
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return await res.json();
}

export async function fetchSharedBg(id: string): Promise<SharedBgPayload> {
  const res = await fetch(`/api/share-bg/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error(body.error ?? 'Shared BG not found or expired');
    }
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return await res.json();
}
