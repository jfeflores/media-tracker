import handler from "vinext/server/app-router-entry";
import { authorizeOwnerRequest } from "../app/lib/owner-auth";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA_TRACKER_AUTH_MODE?: string;
  MEDIA_TRACKER_OWNER_HASH?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // The UI uses ordinary images; disable the unused optimization proxy.
    if (url.pathname === "/_vinext/image") return secure(new Response("Not found", { status: 404 }), url);
    const publicAsset = url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg";
    if (publicAsset) return secure(await env.ASSETS.fetch(request), url);
    if (!publicAsset) {
      const authorization = await authorizeOwnerRequest(request, { runtime: env as unknown as Record<string, unknown> });
      if (!authorization.allowed) {
        if (authorization.status === 401 && env.MEDIA_TRACKER_AUTH_MODE === "sites" && url.pathname === "/") {
          return secure(new Response(null, { status: 302, headers: { location: "/signin-with-chatgpt?return_to=%2F" } }), url);
        }
        const response = url.pathname.startsWith("/api/")
          ? Response.json({ error: authorization.message }, { status: authorization.status })
          : new Response(authorization.message, { status: authorization.status, headers: { "content-type": "text/plain; charset=utf-8" } });
        return secure(response, url);
      }
    }
    try {
      return secure(await handler.fetch(request, env, ctx), url);
    } catch (error) {
      console.error("Request could not be completed", { name: error instanceof Error ? error.name : "UnknownError" });
      return secure(Response.json({ error: "The request could not be completed." }, { status: 500 }), url);
    }
  },
};

function secure(response: Response, url: URL) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:", "img-src 'self' data: blob: https:", "connect-src 'self'",
    "worker-src 'self' blob:", "manifest-src 'self'",
    ...(url.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; "));
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  if (url.protocol === "https:") headers.set("strict-transport-security", "max-age=31536000");
  if (!url.pathname.startsWith("/assets/")) headers.set("cache-control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default worker;
