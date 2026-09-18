/**
 * War planner shared-plan API — read / update / delete.
 *
 * GET    /api/share-plan/<id>
 * PUT    /api/share-plan/<id>   body: { deleteToken, payload, baseVersion }
 * DELETE /api/share-plan/<id>?token=<deleteToken>
 *
 * PUT returns 200 on success with the new version; 409 on version
 * mismatch, with the current stored payload so the client can rebase.
 * The `deleteToken` doubles as the write-auth for PUT — the officer who
 * created the plan keeps it and shares it only with co-officers.
 */

import { validateCreatePayload } from './index.js';

interface Env {
  ROSTERS: KVNamespace;
}

const ID_PATTERN = /^[A-Za-z0-9]{8}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9]{16}$/;
const MAX_PAYLOAD_BYTES = 100_000;
const PLAN_TTL_SECONDS = 60 * 60 * 24 * 30 * 6;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 && body ? 'private, no-cache' : 'no-store',
    },
  });
}

function errorResponse(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...extra }, status);
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) return errorResponse('invalid plan ID format', 400);
  const raw = await env.ROSTERS.get(`plan:${id}`);
  if (!raw) return errorResponse('plan not found or expired', 404);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return errorResponse('stored plan is corrupt', 500);
  }
  const { deleteToken: _, ...publicPlan } = parsed;
  return jsonResponse(publicPlan);
};

export const onRequestPut: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) return errorResponse('invalid plan ID format', 400);
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return errorResponse(`payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`, 413);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid JSON', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('body must be an object', 400);
  }
  const b = body as Record<string, unknown>;
  const deleteToken = b.deleteToken;
  const baseVersion = b.baseVersion;
  const force = b.force === true;
  if (typeof deleteToken !== 'string' || !TOKEN_PATTERN.test(deleteToken)) {
    return errorResponse('invalid deleteToken format', 400);
  }
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
    return errorResponse('baseVersion must be a positive integer', 400);
  }
  const parsed = validateCreatePayload(b.payload);
  if ('error' in parsed) return errorResponse(parsed.error, 400);

  const raw = await env.ROSTERS.get(`plan:${id}`);
  if (!raw) return errorResponse('plan not found or expired', 404);
  let stored: Record<string, unknown>;
  try {
    stored = JSON.parse(raw);
  } catch {
    return errorResponse('stored plan is corrupt', 500);
  }
  if (stored.deleteToken !== deleteToken) {
    return errorResponse('deleteToken does not match', 403);
  }
  const currentVersion = typeof stored.version === 'number' ? stored.version : 1;
  if (currentVersion !== baseVersion && !force) {
    // Conflict — client's baseVersion is stale. Hand back the current
    // stored payload (minus deleteToken) so the client can merge / redo.
    // Client can retry with { force: true } to intentionally overwrite,
    // which is what the "Overwrite theirs" button in the conflict panel
    // does after the officer sees the diff.
    const { deleteToken: _, ...currentPublic } = stored;
    return errorResponse('version conflict', 409, {
      currentVersion,
      currentPayload: currentPublic,
    });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_TTL_SECONDS * 1000);
  const nextVersion = currentVersion + 1;
  const nextStored = {
    ...parsed.payload,
    label: parsed.payload.label ?? null,
    createdAt: stored.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    version: nextVersion,
    deleteToken,
  };
  try {
    await env.ROSTERS.put(`plan:${id}`, JSON.stringify(nextStored), {
      expirationTtl: PLAN_TTL_SECONDS,
    });
  } catch {
    return errorResponse('failed to store plan', 500);
  }
  return jsonResponse({
    id,
    version: nextVersion,
    expiresAt: expiresAt.toISOString(),
  });
};

export const onRequestDelete: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id ?? '');
  if (!ID_PATTERN.test(id)) return errorResponse('invalid plan ID format', 400);
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  if (!TOKEN_PATTERN.test(token)) {
    return errorResponse('invalid delete token format', 400);
  }
  const raw = await env.ROSTERS.get(`plan:${id}`);
  if (!raw) return errorResponse('plan not found or already expired', 404);
  let stored: { deleteToken?: string };
  try {
    stored = JSON.parse(raw);
  } catch {
    return errorResponse('stored plan is corrupt', 500);
  }
  if (stored.deleteToken !== token) {
    return errorResponse('deleteToken does not match', 403);
  }
  try {
    await env.ROSTERS.delete(`plan:${id}`);
  } catch {
    return errorResponse('failed to delete plan', 500);
  }
  return jsonResponse({ ok: true });
};
