/**
 * Roster share API — create.
 *
 * POST /api/share
 *
 * Body: { label?: string, champions: ChampionState[] }
 *
 * Stores the roster in KV under an auto-generated 8-character ID with a
 * 6-month TTL. Returns { id, deleteToken, expiresAt }.
 *
 * Validation:
 *   - Payload must parse as JSON, max 50KB
 *   - Schema must match { label?: string, champions: ChampionState[] }
 *   - Champions array must be 1-500 entries
 *   - Honeypot field "website" must be absent or empty
 *
 * Rate limiting:
 *   - 10 shares per IP per hour
 *   - 100 shares per IP per day
 *   - Implemented via KV counters with TTL
 *
 * The KV namespace `ROSTERS` is bound in the Cloudflare Pages dashboard
 * (Settings → Functions → KV namespace bindings) — see DEPLOY.md.
 */

interface Env {
  ROSTERS: KVNamespace;
}

// Six months in seconds — TTL for share entries
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;
const MAX_PAYLOAD_BYTES = 50_000;
const MAX_CHAMPIONS = 500;
const MIN_CHAMPIONS = 1;
const ID_LENGTH = 8;
const DELETE_TOKEN_LENGTH = 16;

// Rate limits
const RATE_LIMIT_HOUR = 10;
const RATE_LIMIT_DAY = 100;

const VALID_RANKS = new Set([3, 4, 5]);
const VALID_ASCENSIONS = new Set(['A0', 'A1', 'A2']);

type ChampionState = {
  championId: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
};

type SharePayload = {
  label?: string;
  champions: ChampionState[];
  /** Honeypot — should always be empty for real users */
  website?: string;
};

type StoredShare = {
  label: string | null;
  champions: ChampionState[];
  createdAt: string;
  expiresAt: string;
  deleteToken: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Generate a random ID using crypto.getRandomValues — base62 charset (no
 * ambiguous characters like 0/O or 1/l/I dropped, keeping it simple).
 */
function randomId(length: number): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i]! % charset.length];
  }
  return result;
}

/**
 * Strict validation of incoming payload. Belt-and-braces — Zod-equivalent
 * checks without the dependency overhead in the Worker bundle.
 */
function validatePayload(raw: unknown): SharePayload | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'payload must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  // Honeypot — silent reject (no message), this catches dumb bots
  if (typeof obj.website === 'string' && obj.website.length > 0) {
    return { error: 'invalid request' };
  }

  if (obj.label !== undefined) {
    if (typeof obj.label !== 'string') return { error: 'label must be a string' };
    if (obj.label.length > 100) return { error: 'label too long (max 100 chars)' };
  }

  if (!Array.isArray(obj.champions)) {
    return { error: 'champions must be an array' };
  }
  if (obj.champions.length < MIN_CHAMPIONS) {
    return { error: 'champions array is empty' };
  }
  if (obj.champions.length > MAX_CHAMPIONS) {
    return { error: `champions array too long (max ${MAX_CHAMPIONS})` };
  }

  for (let i = 0; i < obj.champions.length; i++) {
    const c = obj.champions[i];
    if (typeof c !== 'object' || c === null) {
      return { error: `champion at index ${i} is not an object` };
    }
    const champ = c as Record<string, unknown>;
    if (typeof champ.championId !== 'string' || champ.championId.length === 0) {
      return { error: `champion at index ${i}: invalid championId` };
    }
    if (champ.championId.length > 200) {
      return { error: `champion at index ${i}: championId too long` };
    }
    if (typeof champ.rank !== 'number' || !VALID_RANKS.has(champ.rank)) {
      return { error: `champion at index ${i}: rank must be 3, 4, or 5` };
    }
    if (typeof champ.sig !== 'number' || champ.sig < 0 || champ.sig > 200) {
      return { error: `champion at index ${i}: sig must be 0-200` };
    }
    if (typeof champ.ascension !== 'string' || !VALID_ASCENSIONS.has(champ.ascension)) {
      return { error: `champion at index ${i}: ascension must be A0, A1, or A2` };
    }
  }

  return {
    label: typeof obj.label === 'string' ? obj.label : undefined,
    champions: obj.champions as ChampionState[],
  };
}

/**
 * Per-IP rate limit. Uses two KV counters with TTL — one hourly bucket,
 * one daily bucket. Cheap. If KV is unavailable we fail-open (allow)
 * rather than block legitimate users on a transient infra issue.
 */
async function checkRateLimit(env: Env, ip: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

  try {
    const [hourCount, dayCount] = await Promise.all([
      env.ROSTERS.get(hourKey),
      env.ROSTERS.get(dayKey),
    ]);

    const hourN = hourCount ? parseInt(hourCount, 10) : 0;
    const dayN = dayCount ? parseInt(dayCount, 10) : 0;

    if (hourN >= RATE_LIMIT_HOUR) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_HOUR} shares per hour exceeded` };
    }
    if (dayN >= RATE_LIMIT_DAY) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_DAY} shares per day exceeded` };
    }

    // Increment counters (fire-and-forget; small race window is acceptable)
    await Promise.all([
      env.ROSTERS.put(hourKey, String(hourN + 1), { expirationTtl: 60 * 60 + 60 }),
      env.ROSTERS.put(dayKey, String(dayN + 1), { expirationTtl: 24 * 60 * 60 + 60 }),
    ]);

    return { ok: true };
  } catch {
    // Fail open on KV unavailability — don't block users on infra issues
    return { ok: true };
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return errorResponse(`payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`, 413);
  }

  // Cloudflare passes the real client IP via CF-Connecting-IP
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';

  // Rate limit
  const rateCheck = await checkRateLimit(env, ip);
  if (!rateCheck.ok) {
    return errorResponse(rateCheck.reason, 429);
  }

  // Parse + validate
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('invalid JSON', 400);
  }

  const result = validatePayload(raw);
  if ('error' in result) {
    return errorResponse(result.error, 400);
  }

  // Generate ID + delete token, store in KV
  const id = randomId(ID_LENGTH);
  const deleteToken = randomId(DELETE_TOKEN_LENGTH);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_SECONDS * 1000);

  const stored: StoredShare = {
    label: result.label ?? null,
    champions: result.champions,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deleteToken,
  };

  try {
    await env.ROSTERS.put(`share:${id}`, JSON.stringify(stored), {
      expirationTtl: SHARE_TTL_SECONDS,
    });
  } catch (err) {
    return errorResponse('failed to store share', 500);
  }

  return jsonResponse({
    id,
    deleteToken,
    expiresAt: expiresAt.toISOString(),
  }, 201);
};

// Reject other methods explicitly
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  return errorResponse(`method ${request.method} not allowed`, 405);
};
