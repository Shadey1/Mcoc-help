/**
 * Roster share API — retrieve, update, delete.
 *
 * GET    /api/share/<id>                            → returns stored share (sans deleteToken)
 * PUT    /api/share/<id>                            → live-share update; body { token, champions?, label?, mode? }
 * DELETE /api/share/<id>?token=<deleteToken>        → removes the share
 *
 * The deleteToken acts as both delete-auth and write-auth: the owner gets
 * it back from POST /api/share and stores it in localStorage. Live shares
 * use it to PUT roster updates; snapshot shares ignore it for writes.
 *
 * All endpoints validate the ID format strictly before hitting KV.
 */

interface Env {
  ROSTERS: KVNamespace;
}

const ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9]{16}$/;

// Six months in seconds — same TTL as POST, so a PUT effectively refreshes
// the expiry (KV needs the TTL on every put). Owners pinging a stale live
// share keeps it alive; an abandoned one expires on schedule.
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;

const MAX_PAYLOAD_BYTES = 50_000;
const MAX_CHAMPIONS = 500;
const MIN_CHAMPIONS = 1;
const MAX_CHAMPION_ID_LEN = 200;

// PUT rate limit — separate from POST. Live shares debounce client-side
// (~10s window), so a heavy editor at one save/min stays well under this.
const PUT_RATE_LIMIT_HOUR = 120;
const PUT_RATE_LIMIT_DAY = 1440;

const VALID_RANKS = new Set([3, 4, 5, 6]);
const VALID_ASCENSIONS = new Set(['A0', 'A1', 'A2']);
const VALID_MODES = new Set(['snapshot', 'live']);

type ShareMode = 'snapshot' | 'live';

type ChampionState = {
  championId: string;
  rank: 3 | 4 | 5 | 6;
  sig: number;
  ascension: 'A0' | 'A1' | 'A2';
};

type StoredShare = {
  label: string | null;
  champions: ChampionState[];
  mode?: ShareMode; // optional on legacy entries
  createdAt: string;
  expiresAt: string;
  lastSyncedAt?: string;
  deleteToken: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Live shares update over time; cache aggressively only when the
      // recipient explicitly asks for a snapshot. 10s is short enough that
      // a live recipient seeing stale data is bounded but still saves
      // some KV reads under polling.
      'cache-control': status === 200 ? 'public, max-age=10' : 'no-store',
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function checkPutRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const hourKey = `rl:put:hr:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  const dayKey = `rl:put:dy:${ip}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
  try {
    const [hourCount, dayCount] = await Promise.all([
      env.ROSTERS.get(hourKey),
      env.ROSTERS.get(dayKey),
    ]);
    const hourN = hourCount ? parseInt(hourCount, 10) : 0;
    const dayN = dayCount ? parseInt(dayCount, 10) : 0;
    if (hourN >= PUT_RATE_LIMIT_HOUR) {
      return {
        ok: false,
        reason: `rate limit: ${PUT_RATE_LIMIT_HOUR} live-share updates per hour exceeded`,
      };
    }
    if (dayN >= PUT_RATE_LIMIT_DAY) {
      return {
        ok: false,
        reason: `rate limit: ${PUT_RATE_LIMIT_DAY} live-share updates per day exceeded`,
      };
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

function validateChampions(value: unknown): { ok: true; champions: ChampionState[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'champions must be an array' };
  }
  if (value.length < MIN_CHAMPIONS) {
    return { ok: false, error: 'champions array is empty' };
  }
  if (value.length > MAX_CHAMPIONS) {
    return { ok: false, error: `champions array too long (max ${MAX_CHAMPIONS})` };
  }
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (typeof c !== 'object' || c === null) {
      return { ok: false, error: `champion at index ${i} is not an object` };
    }
    const champ = c as Record<string, unknown>;
    if (typeof champ.championId !== 'string' || champ.championId.length === 0) {
      return { ok: false, error: `champion at index ${i}: invalid championId` };
    }
    if (champ.championId.length > MAX_CHAMPION_ID_LEN) {
      return { ok: false, error: `champion at index ${i}: championId too long` };
    }
    if (typeof champ.rank !== 'number' || !VALID_RANKS.has(champ.rank)) {
      return { ok: false, error: `champion at index ${i}: rank must be 3, 4, 5, or 6` };
    }
    if (typeof champ.sig !== 'number' || champ.sig < 0 || champ.sig > 200) {
      return { ok: false, error: `champion at index ${i}: sig must be 0-200` };
    }
    if (typeof champ.ascension !== 'string' || !VALID_ASCENSIONS.has(champ.ascension)) {
      return { ok: false, error: `champion at index ${i}: ascension must be A0, A1, or A2` };
    }
  }
  return { ok: true, champions: value as ChampionState[] };
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid share ID format', 400);
  }

  const raw = await env.ROSTERS.get(`share:${id}`);
  if (!raw) {
    return errorResponse('share not found or expired', 404);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored share is corrupt', 500);
  }

  // Don't return the delete token to recipients
  const { deleteToken: _, ...publicShare } = parsed;

  // Legacy entries pre-date the mode/lastSyncedAt fields. Surface stable
  // defaults so the client doesn't need to special-case them.
  if (publicShare.mode === undefined) publicShare.mode = 'snapshot';
  if (publicShare.lastSyncedAt === undefined) {
    publicShare.lastSyncedAt = publicShare.createdAt;
  }

  return jsonResponse(publicShare);
};

export const onRequestPut: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid share ID format', 400);
  }

  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return errorResponse(`payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`, 413);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateCheck = await checkPutRateLimit(env, ip);
  if (!rateCheck.ok) {
    return errorResponse(rateCheck.reason, 429);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('invalid JSON', 400);
  }
  if (typeof raw !== 'object' || raw === null) {
    return errorResponse('payload must be a JSON object', 400);
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) {
    return errorResponse('invalid token format', 400);
  }

  // Fetch the existing share to check the token and merge updates onto.
  const existingRaw = await env.ROSTERS.get(`share:${id}`);
  if (!existingRaw) {
    return errorResponse('share not found or expired', 404);
  }
  let existing: StoredShare;
  try {
    existing = JSON.parse(existingRaw);
  } catch {
    return errorResponse('stored share is corrupt', 500);
  }
  if (existing.deleteToken !== body.token) {
    return errorResponse('invalid token', 403);
  }

  // Optional fields — only validate/apply what's provided.
  let nextChampions = existing.champions;
  if (body.champions !== undefined) {
    const check = validateChampions(body.champions);
    if (!check.ok) return errorResponse(check.error, 400);
    nextChampions = check.champions;
  }
  let nextLabel = existing.label;
  if (body.label !== undefined) {
    if (typeof body.label !== 'string') return errorResponse('label must be a string', 400);
    if (body.label.length > 100) return errorResponse('label too long (max 100 chars)', 400);
    nextLabel = body.label.length > 0 ? body.label : null;
  }
  let nextMode: ShareMode = existing.mode ?? 'snapshot';
  if (body.mode !== undefined) {
    if (typeof body.mode !== 'string' || !VALID_MODES.has(body.mode)) {
      return errorResponse("mode must be 'snapshot' or 'live'", 400);
    }
    nextMode = body.mode as ShareMode;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_SECONDS * 1000);
  const updated: StoredShare = {
    label: nextLabel,
    champions: nextChampions,
    mode: nextMode,
    createdAt: existing.createdAt,
    expiresAt: expiresAt.toISOString(),
    lastSyncedAt: now.toISOString(),
    deleteToken: existing.deleteToken,
  };

  try {
    await env.ROSTERS.put(`share:${id}`, JSON.stringify(updated), {
      expirationTtl: SHARE_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store share', 500);
  }

  return jsonResponse({
    id,
    mode: updated.mode,
    lastSyncedAt: updated.lastSyncedAt,
    expiresAt: updated.expiresAt,
  });
};

export const onRequestDelete: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid share ID format', 400);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    return errorResponse('invalid delete token format', 400);
  }

  const raw = await env.ROSTERS.get(`share:${id}`);
  if (!raw) {
    return errorResponse('share not found or already expired', 404);
  }

  let parsed: { deleteToken?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored share is corrupt', 500);
  }

  if (parsed.deleteToken !== token) {
    // Don't leak whether the share exists vs. wrong token
    return errorResponse('invalid delete token', 403);
  }

  await env.ROSTERS.delete(`share:${id}`);
  return jsonResponse({ deleted: true });
};
