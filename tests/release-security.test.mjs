import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { authorizeOwnerRequest } from "../app/lib/owner-auth.ts";
import { verifyAccessToken, accessIssuer } from "../app/lib/access-token.ts";
import { readJsonObject, isTrustedWriteOrigin, ApiRequestError, MAX_JSON_BYTES } from "../app/lib/request-validation.ts";
import { buildMediaTrackerBackup, mediaTrackerBackupToCsv } from "../app/lib/data-export.ts";
import { fetchProviderJson, __resetMetadataProviderStateForTests } from "../app/lib/metadata-provider.ts";

const hash = createHash("sha256").update("owner@example.com").digest("hex");
const credentialUrl = (value) => { const url = new URL(value); url.username = "test-user"; url.password = "test-pass"; return url.href; };
const accessConfig = { MEDIA_TRACKER_AUTH_MODE: "cloudflare-access", MEDIA_TRACKER_OWNER_HASH: hash,
  CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com", CF_ACCESS_AUD: "test-audience" };

test("production has no implicit header trust or development bypass", async () => {
  for (const runtime of [{}, { MEDIA_TRACKER_AUTH_MODE: "local" }, { MEDIA_TRACKER_AUTH_MODE: "sites" }]) {
    const result = await authorizeOwnerRequest(new Request("http://localhost/api/media", {
      headers: { "oai-authenticated-user-email": "owner@example.com" },
    }), { production: true, runtime });
    assert.equal(result.status, 503);
    assert.equal(result.allowed, false);
  }
  const spoof = await authorizeOwnerRequest(new Request("https://tracker.example/api/media", {
    headers: { "oai-authenticated-user-email": "owner@example.com", "cf-access-authenticated-user-email": "owner@example.com" },
  }), { production: true, runtime: accessConfig });
  assert.equal(spoof.status, 401);
});

test("credential-free development is restricted to loopback", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal((await authorizeOwnerRequest(new Request(`http://${host}/api/media`), { production: false, runtime: {} })).allowed, true);
  }
  assert.equal((await authorizeOwnerRequest(new Request("http://tracker.example/api/media"), { production: false, runtime: {} })).allowed, false);
});

test("Access validates cryptographic signatures, issuer, audience, expiry, algorithm and required claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "unit-test" };
  const resolver = createLocalJWKSet({ keys: [jwk] });
  const issuer = accessConfig.CF_ACCESS_TEAM_DOMAIN;
  const claims = { email: " OWNER@EXAMPLE.COM ", iss: issuer, aud: "test-audience", sub: "test-user",
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 };
  const sign = (value, key = privateKey, alg = "RS256") => new SignJWT(value).setProtectedHeader({ alg, kid: "unit-test" }).sign(key);
  assert.equal(await verifyAccessToken(await sign(claims), issuer, "test-audience", resolver), "owner@example.com");
  for (const changed of [
    { ...claims, iss: "https://other.cloudflareaccess.com" },
    { ...claims, aud: "other-app" },
    { ...claims, exp: 1 },
    { ...claims, exp: undefined },
    { ...claims, sub: undefined },
    { ...claims, email: undefined },
  ]) await assert.rejects(verifyAccessToken(await sign(changed), issuer, "test-audience", resolver));
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifyAccessToken(await sign(claims, other.privateKey), issuer, "test-audience", resolver));
  await assert.rejects(verifyAccessToken(await sign(claims, new TextEncoder().encode("test-key-for-a-disallowed-algorithm"), "HS256"), issuer, "test-audience", resolver));
});

test("Access key discovery accepts only a configured HTTPS team origin", () => {
  assert.equal(accessIssuer("https://example.cloudflareaccess.com/"), "https://example.cloudflareaccess.com");
  for (const input of ["http://example.cloudflareaccess.com", "https://example.cloudflareaccess.com.attacker.example", credentialUrl("https://example.cloudflareaccess.com"), "https://127.0.0.1", "https://example.cloudflareaccess.com/path", "https://example.cloudflareaccess.com?query=1"]) {
    assert.equal(accessIssuer(input), null);
  }
});

test("streamed JSON is bounded even without Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(32_769)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://tracker.example/api/media", { method: "POST", body, duplex: "half" });
  await assert.rejects(readJsonObject(request), (error) => error instanceof ApiRequestError && error.status === 413);
  assert.equal(cancelled, true);
  assert.equal(MAX_JSON_BYTES, 65_536);
});

test("JSON parsing rejects arrays, null, malformed UTF-8 and invalid JSON", async () => {
  for (const body of ["[]", "null", "{broken", new Uint8Array([0xff])]) {
    await assert.rejects(readJsonObject(new Request("https://tracker.example/api/media", { method: "POST", body })), (error) => error.status === 400);
  }
  assert.deepEqual(await readJsonObject(new Request("https://tracker.example/api/media", { method: "POST", body: '{"title":"Sample"}' })), { title: "Sample" });
});

test("write origin checks ignore forged forwarding headers", () => {
  const request = (headers) => new Request("https://tracker.example/api/media", { method: "POST", headers });
  assert.equal(isTrustedWriteOrigin(request({ origin: "https://tracker.example", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isTrustedWriteOrigin(request({ origin: "https://attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" })), false);
  assert.equal(isTrustedWriteOrigin(request({ origin: "https://tracker.example", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isTrustedWriteOrigin(request({})), false);
});

test("CSV exports quote multiline data and neutralize formulas after leading whitespace", () => {
  for (const title of ["=1+1", "  =1+1", "\t@SUM(1)", "\r-1+2", "+1+2"]) {
    const item = { id: "sample", title, genres: [], tags: [], notes: 'A "quoted" note\nSecond line' };
    const backup = buildMediaTrackerBackup([item], []);
    const csv = mediaTrackerBackupToCsv(backup);
    assert.ok(csv.includes(`"'${title}"`));
    assert.ok(csv.includes('"A ""quoted"" note\nSecond line"'));
    assert.equal(backup.items[0].title, title, "JSON backup preserves original values");
    assert.equal(backup.schemaVersion, 1);
  }
});

test("provider requests reject non-provider hosts and credentialed URLs before making requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    for (const url of ["http://api.jikan.moe/v4/anime", "https://127.0.0.1/", "https://api.jikan.moe.attacker.example/", credentialUrl("https://api.jikan.moe/v4/anime")]) {
      await assert.rejects(fetchProviderJson("jikan", url));
    }
    assert.equal(calls, 0);
    globalThis.fetch = async (_url, init) => { assert.equal(init.redirect, "manual"); return Response.json({ ok: true }); };
    assert.deepEqual(await fetchProviderJson("jikan", "https://api.jikan.moe/v4/anime"), { ok: true });
  } finally { globalThis.fetch = original; __resetMetadataProviderStateForTests(); }
});

test("429 honors Retry-After by opening the circuit without an immediate retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 429, headers: { "retry-after": "120" } }); };
  try {
    await assert.rejects(fetchProviderJson("jikan", "https://api.jikan.moe/v4/anime"), (error) => error.failure.code === "rate_limited");
    await assert.rejects(fetchProviderJson("jikan", "https://api.jikan.moe/v4/anime"), (error) => error.failure.code === "circuit_open");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; __resetMetadataProviderStateForTests(); }
});
