/**
 * Calibration-report API.
 *
 * POST /api/calibration-report
 *   Body: { championId, rank, sig, ascension, predictedBhr, actualBhr, website? }
 *   Stores a user-submitted BHR correction in KV. Anonymous — no user
 *   identifier is captured beyond the rate-limit IP bucket.
 *
 * GET /api/calibration-report
 *   Header: Authorization: Bearer <ADMIN_TOKEN>
 *   Lists every stored report, newest first. Used by the /admin/calibrations
 *   review surface so Dave can see which curves users keep flagging and
 *   fold the corrections into the seed.
 *
 * Reuses the `ROSTERS` KV namespace with a `calib:` key prefix — saves
 * adding a second binding. Reports persist for a year (long enough to spot
 * patterns across multiple users hitting the same curve error).
 */

interface Env {
  ROSTERS: KVNamespace;
  /** Bearer token required to read the report list. Set in Cloudflare Pages
   *  Settings → Environment variables. Without it, GET returns 401 even if
   *  the request includes a token. */
  ADMIN_TOKEN?: string;
}

const REPORT_TTL_SECONDS = 60 * 60 * 24 * 365; // one year
const MAX_PAYLOAD_BYTES = 4_000;
const MAX_BHR_VALUE = 200_000;
const MAX_LIST_RESULTS = 500;
const ID_LENGTH = 8;

// Per-IP rate limits — more generous than shares since a single user can
// legitimately calibrate many champions in one session.
const RATE_LIMIT_HOUR = 50;
const RATE_LIMIT_DAY = 200;

const VALID_RANKS = new Set([3, 4, 5]);
const VALID_ASCENSIONS = new Set(['A0', 'A1', 'A2']);

type CalibrationPayload = {
  championId: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  predictedBhr: number;
  actualBhr: number;
  /** Honeypot — silently rejects dumb bots */
  website?: string;
};

type StoredReport = {
  championId: string;
  rank: 3 | 4 | 5;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
  predictedBhr: number;
  actualBhr: number;
  delta: number;
  createdAt: string;
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

function validatePayload(raw: unknown): CalibrationPayload | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'payload must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.website === 'string' && obj.website.length > 0) {
    return { error: 'invalid request' };
  }

  if (typeof obj.championId !== 'string' || obj.championId.length === 0) {
    return { error: 'championId must be a non-empty string' };
  }
  if (obj.championId.length > 200) {
    return { error: 'championId too long' };
  }

  if (typeof obj.rank !== 'number' || !VALID_RANKS.has(obj.rank)) {
    return { error: 'rank must be 3, 4, or 5' };
  }
  if (typeof obj.sig !== 'number' || obj.sig < 0 || obj.sig > 200 || !Number.isInteger(obj.sig)) {
    return { error: 'sig must be an integer 0-200' };
  }
  if (typeof obj.ascension !== 'string' || !VALID_ASCENSIONS.has(obj.ascension)) {
    return { error: 'ascension must be A0, A1, or A2' };
  }
  if (
    typeof obj.predictedBhr !== 'number' ||
    !Number.isFinite(obj.predictedBhr) ||
    obj.predictedBhr <= 0 ||
    obj.predictedBhr > MAX_BHR_VALUE
  ) {
    return { error: `predictedBhr must be a positive number up to ${MAX_BHR_VALUE}` };
  }
  if (
    typeof obj.actualBhr !== 'number' ||
    !Number.isFinite(obj.actualBhr) ||
    obj.actualBhr <= 0 ||
    obj.actualBhr > MAX_BHR_VALUE
  ) {
    return { error: `actualBhr must be a positive number up to ${MAX_BHR_VALUE}` };
  }

  return {
    championId: obj.championId,
    rank: obj.rank as 3 | 4 | 5,
    sig: obj.sig,
    ascension: obj.ascension as 'A0' | 'A1' | 'A2',
    predictedBhr: Math.round(obj.predictedBhr),
    actualBhr: Math.round(obj.actualBhr),
  };
}

async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:calib:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:calib:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

  try {
    const [hourCount, dayCount] = await Promise.all([
      env.ROSTERS.get(hourKey),
      env.ROSTERS.get(dayKey),
    ]);

    const hourN = hourCount ? parseInt(hourCount, 10) : 0;
    const dayN = dayCount ? parseInt(dayCount, 10) : 0;

    if (hourN >= RATE_LIMIT_HOUR) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_HOUR} reports per hour exceeded` };
    }
    if (dayN >= RATE_LIMIT_DAY) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_DAY} reports per day exceeded` };
    }

    await Promise.all([
      env.ROSTERS.put(hourKey, String(hourN + 1), { expirationTtl: 60 * 60 + 60 }),
      env.ROSTERS.put(dayKey, String(dayN + 1), { expirationTtl: 24 * 60 * 60 + 60 }),
    ]);

    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return errorResponse(`payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`, 413);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';

  const rateCheck = await checkRateLimit(env, ip);
  if (!rateCheck.ok) {
    return errorResponse(rateCheck.reason, 429);
  }

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

  // Key: calib:<ISO-timestamp>:<random>  — chronological ordering via prefix
  // listing, randomness avoids collisions on simultaneous submissions.
  const now = new Date();
  const id = randomId(ID_LENGTH);
  const key = `calib:${now.toISOString()}:${id}`;

  const stored: StoredReport = {
    championId: result.championId,
    rank: result.rank,
    sig: result.sig,
    ascension: result.ascension,
    predictedBhr: result.predictedBhr,
    actualBhr: result.actualBhr,
    delta: result.actualBhr - result.predictedBhr,
    createdAt: now.toISOString(),
  };

  try {
    await env.ROSTERS.put(key, JSON.stringify(stored), {
      expirationTtl: REPORT_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store report', 500);
  }

  return jsonResponse({ ok: true }, 201);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Admin-only listing. Require a Bearer token matching the configured
  // ADMIN_TOKEN env var. If the var isn't set, refuse all reads — better
  // to 401 than to leak the report log because someone forgot to set it.
  if (!env.ADMIN_TOKEN) {
    return errorResponse('admin access not configured', 503);
  }

  const auth = request.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== env.ADMIN_TOKEN) {
    return errorResponse('unauthorized', 401);
  }

  try {
    const list = await env.ROSTERS.list({
      prefix: 'calib:',
      limit: MAX_LIST_RESULTS,
    });

    // Fetch in parallel — KV list() returns keys only, not values.
    const reports = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await env.ROSTERS.get(k.name);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as StoredReport;
          return { key: k.name, ...parsed };
        } catch {
          return null;
        }
      }),
    );

    const filtered = reports.filter((r): r is NonNullable<typeof r> => r !== null);
    // Newest first (key embeds ISO timestamp, descending sort gives reverse-chronological)
    filtered.sort((a, b) => b.key.localeCompare(a.key));

    return jsonResponse({
      reports: filtered,
      truncated: list.list_complete === false,
      count: filtered.length,
    });
  } catch {
    return errorResponse('failed to list reports', 500);
  }
};

// Reject other methods explicitly
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  return errorResponse(`method ${request.method} not allowed`, 405);
};
