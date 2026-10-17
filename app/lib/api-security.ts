import { ensureMediaSchema, getD1Binding } from "@/db";
import { authorizeOwnerRequest, requestActorHash } from "@/app/lib/owner-auth";
import { ApiRequestError, MAX_JSON_BYTES, isTrustedWriteOrigin, readJsonObject as parseJsonObject } from "./request-validation.ts";
export { ApiRequestError };

export async function readJsonObject(request: Request) {
  try { return await parseJsonObject(request); }
  catch (error) {
    if (error instanceof ApiRequestError) await recordSecurityEvent(error.status === 413 ? "payload_too_large" : "invalid_json", safeRoute(request));
    throw error;
  }
}

type RequestKind = "read" | "write" | "discover" | "metadata" | "security";

const RATE_LIMITS: Record<RequestKind, number> = {
  read: 240,
  write: 45,
  discover: 30,
  metadata: 30,
  security: 60,
};

export async function guardApiRequest(
  request: Request,
  kind: RequestKind,
  options: { requiresJson?: boolean } = {},
): Promise<Response | null> {
  const route = safeRoute(request);
  const authorization = await authorizeOwnerRequest(request);
  if (!authorization.allowed) {
    await recordSecurityEvent(authorization.eventType, route);
    return Response.json({ error: authorization.message }, { status: authorization.status });
  }

  try {
    await ensureMediaSchema();
  } catch (error) {
    console.error("Database initialization failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json(
      { error: "The private database is temporarily unavailable." },
      { status: 503 },
    );
  }

  if (kind === "write" || kind === "metadata") {
    const requiresJson = options.requiresJson ?? true;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (requiresJson && !contentType.startsWith("application/json")) {
      await recordSecurityEvent("invalid_content_type", route);
      return Response.json({ error: "This request must contain JSON." }, { status: 415 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (requiresJson && Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
      await recordSecurityEvent("payload_too_large", route);
      return Response.json({ error: "The request is too large." }, { status: 413 });
    }

    if (!isTrustedWriteOrigin(request)) {
      await recordSecurityEvent("cross_origin_write", route);
      return Response.json({ error: "Cross-origin writes are not allowed." }, { status: 403 });
    }
  }

  const limitResult = await applyRateLimit(request, kind);
  if (!limitResult.allowed) {
    await recordSecurityEvent("rate_limited", route);
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "retry-after": String(limitResult.retryAfter) } },
    );
  }

  return null;
}

export async function recordSecurityEvent(eventType: string, route: string) {
  try {
    const d1 = await getD1Binding();
    await d1.prepare(
      "INSERT INTO security_events (id, event_type, route) VALUES (?, ?, ?)",
    ).bind(crypto.randomUUID(), eventType.slice(0, 60), route.slice(0, 120)).run();
  } catch (error) {
    console.error("Security event logging failed", { name: error instanceof Error ? error.name : "UnknownError" });
  }
}

async function applyRateLimit(request: Request, kind: RequestKind) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowSeconds = 60;
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const identityHash = await requestActorHash(request);
  const route = safeRoute(request);
  const bucketKey = `${identityHash}:${kind}:${route}:${windowStart}`;
  const d1 = await getD1Binding();
  const row = await d1.prepare(`INSERT INTO request_limits (bucket_key, count, expires_at)
    VALUES (?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1
    RETURNING count`)
    .bind(bucketKey, windowStart + windowSeconds)
    .first<{ count: number }>();
  const allowed = (row?.count ?? 1) <= RATE_LIMITS[kind];
  return { allowed, retryAfter: Math.max(1, windowStart + windowSeconds - nowSeconds) };
}

function safeRoute(request: Request) {
  try {
    return new URL(request.url).pathname
      .replace(/^\/api\/media\/(?!sync(?:\/|$))[^/]+/, "/api/media/:id")
      .replace(/^\/api\/collections\/[^/]+/, "/api/collections/:id")
      .slice(0, 120);
  } catch {
    return "/api/unknown";
  }
}
