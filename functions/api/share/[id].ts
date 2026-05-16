/**
 * Roster share API — retrieve and delete.
 *
 * GET /api/share/<id>           → returns stored share (sans deleteToken)
 * DELETE /api/share/<id>?token=<deleteToken> → removes the share
 *
 * Both endpoints validate the ID format strictly before hitting KV to avoid
 * abuse via malformed paths.
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
      // Allow caching the share briefly — content is immutable for an ID
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

  return jsonResponse(publicShare);
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
