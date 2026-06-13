/**
 * Per-BG roster-list share API — create.
 *
 * POST /api/share-bg
 *
 * Body: { rows: { url, name }[], label?: string }
 *
 * Stores a single battlegroup's player-paste list (up to 10 rows of
 * share-URL + name) in KV under an 8-char ID with a 6-month TTL.
 * Returns { id, deleteToken, expiresAt }.
 *
 * Mirrors /api/share-pool — same KV namespace, same ID + token format,
 * different key prefix (`bg:`). Lets the per-BG "Share BG" button copy a
 * short link instead of a 600+ char inline-base64 URL.
 */

interface Env {
  ROSTERS: KVNamespace;
}

const BG_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;
const MAX_PAYLOAD_BYTES = 50_000;
const PLAYERS_PER_BG = 10;
const MAX_ROW_LEN = 500;
const ID_LENGTH = 8;
const DELETE_TOKEN_LENGTH = 16;

const RATE_LIMIT_HOUR = 20;
const RATE_LIMIT_DAY = 200;

const VALID_RANKS = new Set([3, 4, 5, 6]);
const VALID_ASCENSIONS = new Set(['A0', 'A1', 'A2']);
const MAX_CHAMPION_ID_LEN = 200;
const MAX_POOL_SIZE = 500;

type FloorRank = 3 | 4 | 5 | 6;
type FloorAsc = 'A0' | 'A1' | 'A2';
type BgRow = { url: string; name: string };
type TieredPool = { strong: string[]; mid: string[]; base: string[] };

type BgPayload = {
  label?: string;
  rows: BgRow[];
  /** Optional — when present, the recipient also gets a pool import offer. */
  pool?: TieredPool;
  floor?: { rank: FloorRank; ascension: FloorAsc };
  website?: string;
};

type StoredBg = {
  label: string | null;
  rows: BgRow[];
  pool?: TieredPool;
  floor?: { rank: FloorRank; ascension: FloorAsc };
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

function validatePayload(raw: unknown): BgPayload | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'payload must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.website === 'string' && obj.website.length > 0) {
    return { error: 'invalid request' };
  }

  if (obj.label !== undefined) {
    if (typeof obj.label !== 'string') return { error: 'label must be a string' };
    if (obj.label.length > 100) return { error: 'label too long (max 100 chars)' };
  }

  if (!Array.isArray(obj.rows)) {
    return { error: 'rows must be an array' };
  }
  if (obj.rows.length === 0) {
    return { error: 'rows is empty' };
  }
  if (obj.rows.length > PLAYERS_PER_BG) {
    return { error: `rows has more than ${PLAYERS_PER_BG} players` };
  }

  const cleanRows: BgRow[] = [];
  for (let i = 0; i < obj.rows.length; i++) {
    const row = obj.rows[i] as Record<string, unknown> | undefined;
    if (!row || typeof row !== 'object') {
      return { error: `rows[${i}] must be an object` };
    }
    if (typeof row.url !== 'string' || row.url.length === 0 || row.url.length > MAX_ROW_LEN) {
      return { error: `rows[${i}].url invalid` };
    }
    if (typeof row.name !== 'string' || row.name.length > MAX_ROW_LEN) {
      return { error: `rows[${i}].name invalid` };
    }
    cleanRows.push({ url: row.url, name: row.name });
  }

  // Optional pool — same shape as /api/share-pool. Both pool and floor
  // must be provided together (a pool without a floor is useless).
  let tieredPool: TieredPool | undefined;
  if (obj.pool !== undefined) {
    if (!obj.pool || typeof obj.pool !== 'object' || Array.isArray(obj.pool)) {
      return { error: 'pool must be an object with strong/mid/base arrays' };
    }
    const poolObj = obj.pool as Record<string, unknown>;
    tieredPool = { strong: [], mid: [], base: [] };
    for (const tier of ['strong', 'mid', 'base'] as const) {
      const raw = poolObj[tier];
      if (raw === undefined) continue;
      if (!Array.isArray(raw)) {
        return { error: `pool.${tier} must be an array of champion ids` };
      }
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (typeof c !== 'string' || c.length === 0) {
          return { error: `pool.${tier}[${i}] must be a non-empty string` };
        }
        if (c.length > MAX_CHAMPION_ID_LEN) {
          return { error: `pool.${tier}[${i}] too long` };
        }
        tieredPool[tier].push(c);
      }
    }
    const total =
      tieredPool.strong.length + tieredPool.mid.length + tieredPool.base.length;
    if (total > MAX_POOL_SIZE) {
      return { error: `pool too large (max ${MAX_POOL_SIZE})` };
    }
    // Empty pool is fine here — we'll just drop it on storage so the
    // recipient doesn't get an empty-pool import offer.
    if (total === 0) tieredPool = undefined;
  }

  let floor: { rank: FloorRank; ascension: FloorAsc } | undefined;
  if (obj.floor !== undefined) {
    const f = obj.floor as Record<string, unknown> | null;
    if (!f || typeof f !== 'object') {
      return { error: 'floor must be an object' };
    }
    if (typeof f.rank !== 'number' || !VALID_RANKS.has(f.rank)) {
      return { error: 'floor.rank must be 3, 4, 5, or 6' };
    }
    if (typeof f.ascension !== 'string' || !VALID_ASCENSIONS.has(f.ascension)) {
      return { error: 'floor.ascension must be A0, A1, or A2' };
    }
    floor = { rank: f.rank as FloorRank, ascension: f.ascension as FloorAsc };
  }

  if ((tieredPool && !floor) || (!tieredPool && floor)) {
    return { error: 'pool and floor must be provided together' };
  }

  return {
    label: typeof obj.label === 'string' ? obj.label : undefined,
    rows: cleanRows,
    pool: tieredPool,
    floor,
  };
}

async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:bg:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:bg:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

  try {
    const [hourCount, dayCount] = await Promise.all([
      env.ROSTERS.get(hourKey),
      env.ROSTERS.get(dayKey),
    ]);
    const hourN = hourCount ? parseInt(hourCount, 10) : 0;
    const dayN = dayCount ? parseInt(dayCount, 10) : 0;

    if (hourN >= RATE_LIMIT_HOUR) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_HOUR} BG shares per hour exceeded` };
    }
    if (dayN >= RATE_LIMIT_DAY) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_DAY} BG shares per day exceeded` };
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

  const id = randomId(ID_LENGTH);
  const deleteToken = randomId(DELETE_TOKEN_LENGTH);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BG_TTL_SECONDS * 1000);

  const stored: StoredBg = {
    label: result.label ?? null,
    rows: result.rows,
    pool: result.pool,
    floor: result.floor,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deleteToken,
  };

  try {
    await env.ROSTERS.put(`bg:${id}`, JSON.stringify(stored), {
      expirationTtl: BG_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store BG', 500);
  }

  return jsonResponse(
    {
      id,
      deleteToken,
      expiresAt: expiresAt.toISOString(),
    },
    201,
  );
};

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  return errorResponse(`method ${request.method} not allowed`, 405);
};
