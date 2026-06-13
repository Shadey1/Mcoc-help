/**
 * War defender pool share API — retrieve and delete.
 *
 * GET /api/share-pool/<id>           → returns stored pool (sans deleteToken)
 * DELETE /api/share-pool/<id>?token=<deleteToken> → removes the pool
 *
 * Mirrors /api/share/[id] — same ID + token format, different KV key prefix.
 */

interface Env {
  ROSTERS: KVNamespace;
}

const ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9]{16}$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=60' : 'no-store',
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid pool ID format', 400);
  }

  const raw = await env.ROSTERS.get(`pool:${id}`);
  if (!raw) {
    return errorResponse('pool not found or expired', 404);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored pool is corrupt', 500);
  }

  // Don't return the delete token to recipients
  const { deleteToken: _, ...publicPool } = parsed;

  // Backwards-compat: shares stored before the tiered-pool rollout have
  // pool as a flat string[]. Normalize them to {strong:[],mid:[...],base:[]}
  // so clients only have to handle one shape after parsing.
  if (Array.isArray(publicPool.pool)) {
    publicPool.pool = {
      strong: [],
      mid: publicPool.pool,
      base: [],
    };
  }

  return jsonResponse(publicPool);
};

export const onRequestDelete: PagesFunction<Env> = async ({
  params,
  env,
  request,
}) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid pool ID format', 400);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    return errorResponse('invalid delete token format', 400);
  }

  const raw = await env.ROSTERS.get(`pool:${id}`);
  if (!raw) {
    return errorResponse('pool not found or already expired', 404);
  }

  let parsed: { deleteToken?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored pool is corrupt', 500);
  }

  if (parsed.deleteToken !== token) {
    return errorResponse('invalid delete token', 403);
  }

  await env.ROSTERS.delete(`pool:${id}`);
  return jsonResponse({ deleted: true });
};
