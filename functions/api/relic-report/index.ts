/**
 * Relic rating report API.
 *
 * POST /api/relic-report
 *   Body: { rank, level, rating, predictedRating?, isAlpha?, website? }
 *   Stores a user-submitted 6★ Standard Statcast reading in KV.
 *   Anonymous — no user identifier captured beyond the rate-limit IP bucket.
 *
 * GET /api/relic-report
 *   Header: Authorization: Bearer <ADMIN_TOKEN>
 *   Lists every stored report, newest first. Used by the /admin/calibrations
 *   review surface so Dave can fold confirmed readings into RELIC_RATING.
 *
 * Reuses the `ROSTERS` KV namespace (same binding as shares + champion BHR
 * calibrations) with a `relic:` key prefix. Reports persist for a year.
 */

interface Env {
  ROSTERS: KVNamespace;
  ADMIN_TOKEN?: string;
}

const REPORT_TTL_SECONDS = 60 * 60 * 24 * 365;
const MAX_PAYLOAD_BYTES = 4_000;
const MAX_RATING_VALUE = 10_000;
const MAX_LIST_RESULTS = 500;
const ID_LENGTH = 8;

const RATE_LIMIT_HOUR = 50;
const RATE_LIMIT_DAY = 200;

const VALID_RANKS = new Set(['R1', 'R2', 'R3', 'R4', 'R5']);
const VALID_LEVELS = new Set([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);

type RelicReportPayload = {
  rank: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  level: number;
  rating: number;
  predictedRating?: number;
  isAlpha?: boolean;
  website?: string;
};

type StoredRelicReport = {
  rank: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  level: number;
  rating: number;
  predictedRating: number | null;
  isAlpha: boolean | null;
  delta: number | null;
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

function validatePayload(raw: unknown): RelicReportPayload | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'payload must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.website === 'string' && obj.website.length > 0) {
    return { error: 'invalid request' };
  }

  if (typeof obj.rank !== 'string' || !VALID_RANKS.has(obj.rank)) {
    return { error: 'rank must be R1, R2, R3, R4, or R5' };
  }
  if (typeof obj.level !== 'number' || !VALID_LEVELS.has(obj.level)) {
    return { error: 'level must be one of 0, 20, 40, 60, 80, 100, 120, 140, 160, 180' };
  }
  if (
    typeof obj.rating !== 'number' ||
    !Number.isFinite(obj.rating) ||
    obj.rating <= 0 ||
    obj.rating > MAX_RATING_VALUE
  ) {
    return { error: `rating must be a positive number up to ${MAX_RATING_VALUE}` };
  }
  if (
    obj.predictedRating !== undefined &&
    (typeof obj.predictedRating !== 'number' ||
      !Number.isFinite(obj.predictedRating) ||
      obj.predictedRating <= 0 ||
      obj.predictedRating > MAX_RATING_VALUE)
  ) {
    return { error: `predictedRating must be a positive number up to ${MAX_RATING_VALUE}` };
  }
  if (obj.isAlpha !== undefined && typeof obj.isAlpha !== 'boolean') {
    return { error: 'isAlpha must be a boolean' };
  }

  return {
    rank: obj.rank as RelicReportPayload['rank'],
    level: obj.level,
    rating: Math.round(obj.rating),
    predictedRating:
      typeof obj.predictedRating === 'number'
        ? Math.round(obj.predictedRating)
        : undefined,
    isAlpha: typeof obj.isAlpha === 'boolean' ? obj.isAlpha : undefined,
  };
}

async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:relic:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:relic:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

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

  const now = new Date();
  const id = randomId(ID_LENGTH);
  const key = `relic:${now.toISOString()}:${id}`;

  const stored: StoredRelicReport = {
    rank: result.rank,
    level: result.level,
    rating: result.rating,
    predictedRating: result.predictedRating ?? null,
    isAlpha: result.isAlpha ?? null,
    delta:
      result.predictedRating !== undefined
        ? result.rating - result.predictedRating
        : null,
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
      prefix: 'relic:',
      limit: MAX_LIST_RESULTS,
    });

    const reports = await Promise.all(
      list.keys.map(async (k) => {
        const raw = await env.ROSTERS.get(k.name);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as StoredRelicReport;
          return { key: k.name, ...parsed };
        } catch {
          return null;
        }
      }),
    );

    const filtered = reports.filter((r): r is NonNullable<typeof r> => r !== null);
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

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  return errorResponse(`method ${request.method} not allowed`, 405);
};
