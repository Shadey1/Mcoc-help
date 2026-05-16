import type { ChampionState } from '@prestige-tools/engine';

/**
 * Client-side wrappers around the share API.
 *
 * Three operations:
 *   - createShare()  → POST /api/share, returns { id, deleteToken, expiresAt }
 *   - fetchShare(id) → GET /api/share/<id>, returns the stored payload
 *   - deleteShare()  → DELETE /api/share/<id>?token=<token>
 *
 * All operations throw on non-2xx responses with the server's error message.
 */

export type SharedRosterPayload = {
  label: string | null;
  champions: ChampionState[];
  createdAt: string;
  expiresAt: string;
};

export type CreateShareResponse = {
  id: string;
  deleteToken: string;
  expiresAt: string;
};

export async function createShare(
  champions: ChampionState[],
  label: string | null,
): Promise<CreateShareResponse> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: label ?? undefined,
      champions,
      // Honeypot — real users never fill this. Bots that submit JSON blindly do.
      website: '',
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `request failed (${res.status})` })) as { error?: string };
    if (res.status === 404) {
      throw new Error("Sharing only works once deployed to Cloudflare Pages — the /api/share endpoint isn't available in local dev.");
    }
    throw new Error(error.error ?? `request failed (${res.status})`);
  }

  return await res.json();
}

export async function fetchShare(id: string): Promise<SharedRosterPayload> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `request failed (${res.status})` })) as { error?: string };
    if (res.status === 404) {
      throw new Error("Sharing only works once deployed to Cloudflare Pages — the /api/share endpoint isn't available in local dev.");
    }
    throw new Error(error.error ?? `request failed (${res.status})`);
  }
  return await res.json();
}

export async function deleteShare(id: string, token: string): Promise<void> {
  const res = await fetch(
    `/api/share/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `request failed (${res.status})` })) as { error?: string };
    if (res.status === 404) {
      throw new Error("Sharing only works once deployed to Cloudflare Pages — the /api/share endpoint isn't available in local dev.");
    }
    throw new Error(error.error ?? `request failed (${res.status})`);
  }
}

/**
 * Save a share's metadata in localStorage so the user can manage their own
 * shares later (delete them, see what they've shared).
 */
const LOCAL_SHARES_KEY = 'prestige-tools:my-shares';

export type LocalShareEntry = {
  id: string;
  deleteToken: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
};

export function recordLocalShare(entry: LocalShareEntry): void {
  if (typeof window === 'undefined') return;
  const existing = loadLocalShares();
  const updated = [entry, ...existing.filter((e) => e.id !== entry.id)];
  // Keep only the most recent 50 — prevent unbounded growth
  localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(updated.slice(0, 50)));
}

export function loadLocalShares(): LocalShareEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_SHARES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function forgetLocalShare(id: string): void {
  if (typeof window === 'undefined') return;
  const existing = loadLocalShares();
  localStorage.setItem(
    LOCAL_SHARES_KEY,
    JSON.stringify(existing.filter((e) => e.id !== id)),
  );
}
