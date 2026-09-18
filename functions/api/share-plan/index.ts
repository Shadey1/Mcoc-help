/**
 * War planner shared-plan API — create.
 *
 * POST /api/share-plan
 *
 * Body:
 *   {
 *     bg: 1|2|3,
 *     season: number,
 *     pickOverrides: { [node]: championId[] },
 *     keyNodes: number[],
 *     pins: { [node]: { championId, playerId | null } },
 *     excludedPlayers: string[],
 *     strict: boolean,
 *     lastPlacement?: { [node]: { championId, playerId, pickRank, pinned } },
 *     rosterShareIds: string[],   // ≤10 individual roster share IDs
 *     playerNames?: { [id]: string },  // shareId → alliance name
 *     label?: string,
 *   }
 *
 * Stores in KV under `plan:<id>` with a 6-month TTL. Returns:
 *   { id, deleteToken, expiresAt, version: 1 }
 *
 * Editable — see `[id].ts` for GET/PUT/DELETE. Different KV prefix from
 * /api/share-bg on purpose: the plan is a different kind of thing from a
 * roster share, needs a version field for optimistic concurrency, and
 * we don't want to overload the snapshot-only semantics of share-bg.
 */

interface Env {
  ROSTERS: KVNamespace;
}

const PLAN_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;
const MAX_PAYLOAD_BYTES = 100_000;
const MAX_ROSTER_IDS = 10;
const MAX_LABEL_LEN = 100;
const MAX_CHAMPION_ID_LEN = 200;
const MAX_PLAYER_ID_LEN = 200;
const ID_LENGTH = 8;
const DELETE_TOKEN_LENGTH = 16;

const RATE_LIMIT_HOUR = 30;
const RATE_LIMIT_DAY = 300;

type NodeStr = string;
type PinPayload = { championId: string; playerId: string | null };
type PlacementPayload = { championId: string; playerId: string; pickRank: number; pinned: boolean };

type CreatePlanPayload = {
  bg: 1 | 2 | 3;
  season: number;
  pickOverrides: Record<NodeStr, string[]>;
  keyNodes: number[];
  pins: Record<NodeStr, PinPayload>;
  excludedPlayers: string[];
  strict: boolean;
  lastPlacement?: Record<NodeStr, PlacementPayload>;
  rosterShareIds: string[];
  playerNames?: Record<string, string>;
  label?: string;
  website?: string;
};

type StoredPlan = Omit<CreatePlanPayload, 'website'> & {
  label: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  version: number;
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
  let out = '';
  for (let i = 0; i < length; i++) out += charset[bytes[i]! % charset.length];
  return out;
}

function isNodeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 50;
}

function isString(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

/** Validate + normalise the incoming payload. Returns either the clean
 *  payload or an error message; callers translate that to an HTTP 400. */
export function validateCreatePayload(
  raw: unknown,
): { payload: CreatePlanPayload } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'body must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.website === 'string' && obj.website.length > 0) {
    return { error: 'invalid request' };
  }
  if (obj.bg !== 1 && obj.bg !== 2 && obj.bg !== 3) {
    return { error: 'bg must be 1, 2, or 3' };
  }
  if (typeof obj.season !== 'number' || !Number.isInteger(obj.season) || obj.season < 1) {
    return { error: 'season must be a positive integer' };
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== 'string') return { error: 'label must be a string' };
    if (obj.label.length > MAX_LABEL_LEN) return { error: 'label too long' };
  }
  if (typeof obj.strict !== 'boolean') return { error: 'strict must be a boolean' };
  if (!Array.isArray(obj.keyNodes)) return { error: 'keyNodes must be an array' };
  for (const n of obj.keyNodes) {
    if (!isNodeNumber(n)) return { error: 'keyNodes entries must be 1..50' };
  }
  if (!Array.isArray(obj.excludedPlayers)) return { error: 'excludedPlayers must be an array' };
  for (const p of obj.excludedPlayers) {
    if (!isString(p, MAX_PLAYER_ID_LEN)) return { error: 'excludedPlayers entry invalid' };
  }
  if (!Array.isArray(obj.rosterShareIds)) return { error: 'rosterShareIds must be an array' };
  if (obj.rosterShareIds.length > MAX_ROSTER_IDS) {
    return { error: `too many rosterShareIds (max ${MAX_ROSTER_IDS})` };
  }
  for (const id of obj.rosterShareIds) {
    if (!isString(id, 8) || !/^[A-Za-z0-9]{8}$/.test(id)) {
      return { error: 'rosterShareIds entry must be an 8-char alphanumeric id' };
    }
  }
  // pickOverrides
  if (!obj.pickOverrides || typeof obj.pickOverrides !== 'object' || Array.isArray(obj.pickOverrides)) {
    return { error: 'pickOverrides must be an object' };
  }
  const pickOverrides: Record<NodeStr, string[]> = {};
  for (const [k, v] of Object.entries(obj.pickOverrides as Record<string, unknown>)) {
    const n = Number(k);
    if (!isNodeNumber(n)) return { error: `pickOverrides key ${k} is not a node number` };
    if (!Array.isArray(v)) return { error: `pickOverrides[${k}] must be an array` };
    if (v.length > 8) return { error: `pickOverrides[${k}] has more than 8 entries` };
    const list: string[] = [];
    for (const c of v) {
      if (!isString(c, MAX_CHAMPION_ID_LEN)) return { error: `pickOverrides[${k}] entry invalid` };
      list.push(c);
    }
    pickOverrides[String(n)] = list;
  }
  // pins
  if (!obj.pins || typeof obj.pins !== 'object' || Array.isArray(obj.pins)) {
    return { error: 'pins must be an object' };
  }
  const pins: Record<NodeStr, PinPayload> = {};
  for (const [k, v] of Object.entries(obj.pins as Record<string, unknown>)) {
    const n = Number(k);
    if (!isNodeNumber(n)) return { error: `pins key ${k} is not a node number` };
    if (!v || typeof v !== 'object') return { error: `pins[${k}] must be an object` };
    const p = v as Record<string, unknown>;
    if (!isString(p.championId, MAX_CHAMPION_ID_LEN)) {
      return { error: `pins[${k}].championId invalid` };
    }
    if (p.playerId !== null && !isString(p.playerId, MAX_PLAYER_ID_LEN)) {
      return { error: `pins[${k}].playerId must be a string or null` };
    }
    pins[String(n)] = { championId: p.championId, playerId: p.playerId as string | null };
  }
  // lastPlacement optional
  let lastPlacement: Record<NodeStr, PlacementPayload> | undefined;
  if (obj.lastPlacement !== undefined) {
    if (!obj.lastPlacement || typeof obj.lastPlacement !== 'object' || Array.isArray(obj.lastPlacement)) {
      return { error: 'lastPlacement must be an object' };
    }
    lastPlacement = {};
    for (const [k, v] of Object.entries(obj.lastPlacement as Record<string, unknown>)) {
      const n = Number(k);
      if (!isNodeNumber(n)) return { error: `lastPlacement key ${k} invalid` };
      if (!v || typeof v !== 'object') return { error: `lastPlacement[${k}] must be an object` };
      const p = v as Record<string, unknown>;
      if (!isString(p.championId, MAX_CHAMPION_ID_LEN)) return { error: `lastPlacement[${k}].championId invalid` };
      if (!isString(p.playerId, MAX_PLAYER_ID_LEN)) return { error: `lastPlacement[${k}].playerId invalid` };
      if (typeof p.pickRank !== 'number') return { error: `lastPlacement[${k}].pickRank must be a number` };
      if (typeof p.pinned !== 'boolean') return { error: `lastPlacement[${k}].pinned must be boolean` };
      lastPlacement[String(n)] = {
        championId: p.championId,
        playerId: p.playerId,
        pickRank: p.pickRank,
        pinned: p.pinned,
      };
    }
  }
  // playerNames optional
  let playerNames: Record<string, string> | undefined;
  if (obj.playerNames !== undefined) {
    if (!obj.playerNames || typeof obj.playerNames !== 'object' || Array.isArray(obj.playerNames)) {
      return { error: 'playerNames must be an object' };
    }
    playerNames = {};
    for (const [k, v] of Object.entries(obj.playerNames as Record<string, unknown>)) {
      if (!isString(k, MAX_PLAYER_ID_LEN)) return { error: `playerNames key invalid` };
      if (!isString(v, MAX_LABEL_LEN)) return { error: `playerNames[${k}] value invalid` };
      playerNames[k] = v;
    }
  }
  return {
    payload: {
      bg: obj.bg as 1 | 2 | 3,
      season: obj.season,
      pickOverrides,
      keyNodes: obj.keyNodes as number[],
      pins,
      excludedPlayers: obj.excludedPlayers as string[],
      strict: obj.strict,
      lastPlacement,
      rosterShareIds: obj.rosterShareIds as string[],
      playerNames,
      label: typeof obj.label === 'string' ? obj.label : undefined,
    },
  };
}

async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:plan:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:plan:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
  try {
    const [h, d] = await Promise.all([env.ROSTERS.get(hourKey), env.ROSTERS.get(dayKey)]);
    const hn = h ? parseInt(h, 10) : 0;
    const dn = d ? parseInt(d, 10) : 0;
    if (hn >= RATE_LIMIT_HOUR) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_HOUR} plans/hour exceeded` };
    }
    if (dn >= RATE_LIMIT_DAY) {
      return { ok: false, reason: `rate limit: ${RATE_LIMIT_DAY} plans/day exceeded` };
    }
    await Promise.all([
      env.ROSTERS.put(hourKey, String(hn + 1), { expirationTtl: 60 * 60 + 60 }),
      env.ROSTERS.put(dayKey, String(dn + 1), { expirationTtl: 24 * 60 * 60 + 60 }),
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
  const rate = await checkRateLimit(env, ip);
  if (!rate.ok) return errorResponse(rate.reason, 429);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('invalid JSON', 400);
  }
  const parsed = validateCreatePayload(raw);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const id = randomId(ID_LENGTH);
  const deleteToken = randomId(DELETE_TOKEN_LENGTH);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_TTL_SECONDS * 1000);
  const stored: StoredPlan = {
    ...parsed.payload,
    label: parsed.payload.label ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    version: 1,
    deleteToken,
  };
  try {
    await env.ROSTERS.put(`plan:${id}`, JSON.stringify(stored), {
      expirationTtl: PLAN_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store plan', 500);
  }
  return jsonResponse({ id, deleteToken, expiresAt: expiresAt.toISOString(), version: 1 }, 201);
};
