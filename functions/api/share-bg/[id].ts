/**
 * Per-BG share API — retrieve and delete.
 *
 * GET /api/share-bg/<id>
 * DELETE /api/share-bg/<id>?token=<deleteToken>
 *
 * Mirrors /api/share-pool/[id], different KV key prefix (`bg:`).
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
    return errorResponse('invalid BG ID format', 400);
  }

  const raw = await env.ROSTERS.get(`bg:${id}`);
  if (!raw) {
    return errorResponse('BG not found or expired', 404);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored BG is corrupt', 500);
  }

  const { deleteToken: _, ...publicBg } = parsed;
  return jsonResponse(publicBg);
};

export const onRequestDelete: PagesFunction<Env> = async ({
  params,
  env,
  request,
}) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) {
    return errorResponse('invalid BG ID format', 400);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    return errorResponse('invalid delete token format', 400);
  }

  const raw = await env.ROSTERS.get(`bg:${id}`);
  if (!raw) {
    return errorResponse('BG not found or already expired', 404);
  }

  let parsed: { deleteToken?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored BG is corrupt', 500);
  }

  if (parsed.deleteToken !== token) {
    return errorResponse('invalid delete token', 403);
  }

  await env.ROSTERS.delete(`bg:${id}`);
  return jsonResponse({ deleted: true });
};
