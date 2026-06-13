'use client';

import type { WarPlayerInput } from './war-storage';

export type SharedBgPayload = {
  label: string | null;
  rows: WarPlayerInput[];
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
 */
export async function createSharedBg(
  rows: WarPlayerInput[],
  label?: string,
): Promise<CreateBgResponse> {
  const trimmed = rows.filter((r) => r.url.trim().length > 0);
  if (trimmed.length === 0) {
    throw new Error('No rows to share — add at least one share URL.');
  }

  const res = await fetch('/api/share-bg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rows: trimmed,
      ...(label ? { label } : {}),
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
