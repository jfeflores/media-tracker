import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const resolvers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function accessIssuer(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(url.hostname)
      || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// The key URL comes only from operator configuration, never a token's jku/iss.
export async function verifyAccessToken(
  token: string, issuer: string, audience: string, key?: JWTVerifyGetKey,
): Promise<string> {
  const validatedIssuer = accessIssuer(issuer);
  if (!validatedIssuer || !audience || token.length > 16_384) throw new Error("Invalid Access configuration or token.");
  let resolver = key ?? resolvers.get(validatedIssuer);
  if (!resolver) {
    const remote = createRemoteJWKSet(new URL(`${validatedIssuer}/cdn-cgi/access/certs`), {
      timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 300_000,
    });
    if (resolvers.size >= 4) resolvers.clear();
    resolvers.set(validatedIssuer, remote);
    resolver = remote;
  }
  const { payload } = await jwtVerify(token, resolver, {
    issuer: validatedIssuer, audience, algorithms: ["RS256"],
    requiredClaims: ["iss", "aud", "sub", "exp", "iat", "email"],
  });
  if (typeof payload.email !== "string" || !payload.email.trim() || payload.email.length > 320) {
    throw new Error("An authenticated user email is required.");
  }
  return payload.email.trim().toLowerCase();
}
