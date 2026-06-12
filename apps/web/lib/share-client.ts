import type { ChampionState } from '@prestige-tools/engine';

/**
 * Client-side wrappers around the share API.
 *
 * Four operations:
 *   - createShare()  → POST /api/share, returns { id, deleteToken, expiresAt }
 *   - fetchShare(id) → GET /api/share/<id>, returns the stored payload
 *   - updateShare()  → PUT /api/share/<id>, live-share roster update
 *   - deleteShare()  → DELETE /api/share/<id>?token=<token>
 *
 * All operations throw on non-2xx responses with the server's error message.
 */

export type ShareMode = 'snapshot' | 'live';

export type SharedRosterPayload = {
  label: string | null;
  champions: ChampionState[];
  /** Defaults to 'snapshot' on legacy shares created before the live flag. */
  mode: ShareMode;
  createdAt: string;
  /** ISO timestamp of the last PUT update (or createdAt if never updated). */
  lastSyncedAt: string;
  expiresAt: string;
};

export type CreateShareResponse = {
  id: string;
  deleteToken: string;
  expiresAt: string;
};

export type UpdateShareResponse = {
  id: string;
  mode: ShareMode;
  lastSyncedAt: string;
  expiresAt: string;
};

export async function createShare(
  champions: ChampionState[],
  label: string | null,
  mode: ShareMode = 'live',
): Promise<CreateShareResponse> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: label ?? undefined,
      champions,
      mode,
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

/**
 * PUT a live update to an existing share. Pass only the fields you want to
 * change — omitted fields are preserved by the server. The token is the
 * deleteToken returned at creation; it doubles as the write-auth.
 *
 * Returns the new lastSyncedAt timestamp so callers can show a fresh
 * "synced just now" indicator.
 */
export async function updateShare(
  id: string,
  token: string,
  changes: {
    champions?: ChampionState[];
    label?: string;
    mode?: ShareMode;
  },
): Promise<UpdateShareResponse> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, ...changes }),
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => ({
      error: `request failed (${res.status})`,
    }))) as { error?: string };
    if (res.status === 404) {
      throw new Error("Share not found — it may have expired or been deleted.");
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
  /** Defaults to 'snapshot' on legacy entries; new shares record their mode. */
  mode?: ShareMode;
  createdAt: string;
  /** ISO timestamp of the last successful PUT. Updated by the auto-sync loop. */
  lastSyncedAt?: string;
  expiresAt: string;
};

/** Update the lastSyncedAt of a saved local share — no-op if id unknown. */
export function touchLocalShareSync(id: string, lastSyncedAt: string): void {
  if (typeof window === 'undefined') return;
  const existing = loadLocalShares();
  const next = existing.map((e) =>
    e.id === id ? { ...e, lastSyncedAt } : e,
  );
  localStorage.setItem(LOCAL_SHARES_KEY, JSON.stringify(next));
}

/** Returns only the live shares saved locally, oldest createdAt first removed. */
export function loadLiveLocalShares(): LocalShareEntry[] {
  return loadLocalShares().filter((e) => e.mode === 'live');
}

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
