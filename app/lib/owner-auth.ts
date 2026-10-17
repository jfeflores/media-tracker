import { accessIssuer, verifyAccessToken } from "./access-token.ts";
import { envText, getRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-env.ts";

export type OwnerAuthorization = {
  allowed: boolean;
  status: 200 | 401 | 403 | 503;
  eventType: "authorized" | "unauthorized" | "forbidden_user" | "owner_not_configured";
  message: string;
  actorHash: string | null;
};

const authorizations = new WeakMap<Request, Promise<OwnerAuthorization>>();
const actorHashes = new WeakMap<Request, string>();

export function isLoopback(url: URL) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function authorizeOwnerRequest(
  request: Request,
  options: { production?: boolean; expectedOwnerHash?: string | null; runtime?: RuntimeEnvironment } = {},
): Promise<OwnerAuthorization> {
  if (!Object.keys(options).length) {
    const cached = authorizations.get(request);
    if (cached) return cached;
  }
  const pending = authorize(request, options);
  if (!Object.keys(options).length) authorizations.set(request, pending);
  const result = await pending;
  if (result.actorHash) actorHashes.set(request, result.actorHash);
  return result;
}

async function authorize(request: Request, options: {
  production?: boolean; expectedOwnerHash?: string | null; runtime?: RuntimeEnvironment;
}): Promise<OwnerAuthorization> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const runtime = options.runtime ?? await getRuntimeEnvironment();
  const mode = envText(runtime, "MEDIA_TRACKER_AUTH_MODE");
  if (!production && !mode && isLoopback(new URL(request.url))) return allowed(await sha256("local-preview"));
  if (mode !== "sites" && mode !== "cloudflare-access") return unavailable();
  const ownerHash = options.expectedOwnerHash === undefined
    ? envText(runtime, "MEDIA_TRACKER_OWNER_HASH").toLowerCase()
    : options.expectedOwnerHash?.trim().toLowerCase();
  if (!ownerHash || !/^[a-f0-9]{64}$/.test(ownerHash)) return unavailable();

  let email: string;
  if (mode === "cloudflare-access") {
    const issuer = accessIssuer(envText(runtime, "CF_ACCESS_TEAM_DOMAIN"));
    const audience = envText(runtime, "CF_ACCESS_AUD");
    if (!issuer || !audience) return unavailable();
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return unauthenticated();
    try { email = await verifyAccessToken(token, issuer, audience); }
    catch { return unauthenticated(); }
  } else {
    // ONLY the managed Sites dispatcher may supply these identity headers.
    email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
    if (!email) return unauthenticated();
  }
  const actorHash = await sha256(email);
  if (!constantTimeEqual(actorHash, ownerHash)) {
    return { allowed: false, status: 403, eventType: "forbidden_user",
      message: "This private tracker is restricted to its owner.", actorHash: null };
  }
  return allowed(actorHash);
}

export async function requestActorHash(request: Request) {
  const cached = actorHashes.get(request);
  if (cached) return cached;
  const authorization = await authorizeOwnerRequest(request);
  if (!authorization.allowed || !authorization.actorHash) throw new Error("Owner authorization is required.");
  return authorization.actorHash;
}

function allowed(actorHash: string): OwnerAuthorization {
  return { allowed: true, status: 200, eventType: "authorized", message: "Owner verified", actorHash };
}
function unavailable(): OwnerAuthorization {
  return { allowed: false, status: 503, eventType: "owner_not_configured",
    message: "Owner authorization is not configured.", actorHash: null };
}
function unauthenticated(): OwnerAuthorization {
  return { allowed: false, status: 401, eventType: "unauthorized",
    message: "Authentication is required.", actorHash: null };
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
