/**
 * War defender pool share API — create.
 *
 * POST /api/share-pool
 *
 * Body: { label?: string, pool: string[], floor: { rank, ascension } }
 *
 * Stores an alliance's war-defender pool in KV under an auto-generated
 * 8-character ID with a 6-month TTL. Returns { id, deleteToken, expiresAt }.
 *
 * Mirrors the /api/share endpoint shape — same KV namespace (ROSTERS),
 * same ID + token format, just a different key prefix (`pool:`). Officer
 * generates a link, drops it in the alliance chat, members load the pool
 * with one click via /war?pool=<id>.
 */

interface Env {
  ROSTERS: KVNamespace;
}

const POOL_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;
const MAX_PAYLOAD_BYTES = 50_000;
const MAX_POOL_SIZE = 500;
const MIN_POOL_SIZE = 1;
const MAX_CHAMPION_ID_LEN = 200;
const ID_LENGTH = 8;
const DELETE_TOKEN_LENGTH = 16;

const RATE_LIMIT_HOUR = 10;
const RATE_LIMIT_DAY = 100;

const VALID_RANKS = new Set([3, 4, 5, 6]);
const VALID_ASCENSIONS = new Set(['A0', 'A1', 'A2']);

const MAX_BG_ROW_LEN = 500; // share URL + name fits comfortably
const PLAYERS_PER_BG = 10;
const BG_COUNT = 3;

type FloorRank = 3 | 4 | 5 | 6;
type FloorAsc = 'A0' | 'A1' | 'A2';
type BgRow = { url: string; name: string };

type PoolPayload = {
  label?: string;
  pool: string[];
  floor: { rank: FloorRank; ascension: FloorAsc };
  /** Optional BG roster paste URLs — three groups of up to 10. */
  bgs?: BgRow[][];
  website?: string;
};

type StoredPool = {
  label: string | null;
  pool: string[];
  floor: { rank: FloorRank; ascension: FloorAsc };
  bgs?: BgRow[][];
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

function validatePayload(raw: unknown): PoolPayload | { error: string } {
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

  if (!Array.isArray(obj.pool)) {
    return { error: 'pool must be an array of champion ids' };
  }
  if (obj.pool.length < MIN_POOL_SIZE) {
    return { error: 'pool is empty' };
  }
  if (obj.pool.length > MAX_POOL_SIZE) {
    return { error: `pool too large (max ${MAX_POOL_SIZE})` };
  }
  for (let i = 0; i < obj.pool.length; i++) {
    const c = obj.pool[i];
    if (typeof c !== 'string' || c.length === 0) {
      return { error: `pool[${i}] must be a non-empty string` };
    }
    if (c.length > MAX_CHAMPION_ID_LEN) {
      return { error: `pool[${i}] too long` };
    }
  }

  const floor = obj.floor as Record<string, unknown> | undefined;
  if (!floor || typeof floor !== 'object') {
    return { error: 'floor must be an object' };
  }
  if (typeof floor.rank !== 'number' || !VALID_RANKS.has(floor.rank)) {
    return { error: 'floor.rank must be 3, 4, 5, or 6' };
  }
  if (typeof floor.ascension !== 'string' || !VALID_ASCENSIONS.has(floor.ascension)) {
    return { error: 'floor.ascension must be A0, A1, or A2' };
  }

  // Optional bgs: 3 arrays, each ≤10 rows of { url, name } strings. Reject
  // anything outside that shape so the KV blob can't be poisoned.
  let bgs: BgRow[][] | undefined;
  if (obj.bgs !== undefined) {
    if (!Array.isArray(obj.bgs) || obj.bgs.length > BG_COUNT) {
      return { error: `bgs must be an array of up to ${BG_COUNT} groups` };
    }
    bgs = [];
    for (let g = 0; g < obj.bgs.length; g++) {
      const group = obj.bgs[g];
      if (!Array.isArray(group)) {
        return { error: `bgs[${g}] must be an array` };
      }
      if (group.length > PLAYERS_PER_BG) {
        return { error: `bgs[${g}] has more than ${PLAYERS_PER_BG} players` };
      }
      const cleanGroup: BgRow[] = [];
      for (let i = 0; i < group.length; i++) {
        const row = group[i] as Record<string, unknown> | undefined;
        if (!row || typeof row !== 'object') {
          return { error: `bgs[${g}][${i}] must be an object` };
        }
        if (typeof row.url !== 'string' || row.url.length > MAX_BG_ROW_LEN) {
          return { error: `bgs[${g}][${i}].url invalid` };
        }
        if (typeof row.name !== 'string' || row.name.length > MAX_BG_ROW_LEN) {
          return { error: `bgs[${g}][${i}].name invalid` };
        }
        cleanGroup.push({ url: row.url, name: row.name });
      }
      bgs.push(cleanGroup);
    }
  }

  return {
    label: typeof obj.label === 'string' ? obj.label : undefined,
    pool: obj.pool as string[],
    floor: {
      rank: floor.rank as FloorRank,
      ascension: floor.ascension as FloorAsc,
    },
    bgs,
  };
}

async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:pool:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:pool:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

  try {
    const [hourCount, dayCount] = await Promise.all([
      env.ROSTERS.get(hourKey),
      env.ROSTERS.get(dayKey),
    ]);
    const hourN = hourCount ? parseInt(hourCount, 10) : 0;
    const dayN = dayCount ? parseInt(dayCount, 10) : 0;

    if (hourN >= RATE_LIMIT_HOUR) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_HOUR} pool shares per hour exceeded` };
    }
    if (dayN >= RATE_LIMIT_DAY) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_DAY} pool shares per day exceeded` };
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
  const expiresAt = new Date(now.getTime() + POOL_TTL_SECONDS * 1000);

  const stored: StoredPool = {
    label: result.label ?? null,
    pool: result.pool,
    floor: result.floor,
    bgs: result.bgs,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    deleteToken,
  };

  try {
    await env.ROSTERS.put(`pool:${id}`, JSON.stringify(stored), {
      expirationTtl: POOL_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store pool', 500);
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
