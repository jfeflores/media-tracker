import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

const { default: worker } = await import("../dist/server/index.js");
const ctx = { waitUntil() {}, passThroughOnException() {} };
const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  MEDIA_TRACKER_AUTH_MODE: "sites",
  MEDIA_TRACKER_OWNER_HASH: createHash("sha256").update("owner@example.com").digest("hex"),
};

test("renders the authenticated shell without serializing a profile or preview metadata", async () => {
  const response = await worker.fetch(new Request("https://tracker.example/", {
    headers: { accept: "text/html", "oai-authenticated-user-email": "owner@example.com",
      "oai-authenticated-user-full-name": "Private%20Name" },
  }), env, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Media Tracker<\/title>/);
  assert.match(html, />Tier list</);
  assert.doesNotMatch(html, /codex-preview|owner@example\.com|Private%20Name|Private Name/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("rejects unconfigured production, missing owners, non-owners, and spoofed headers before rendering", async () => {
  for (const [config, headers, expected] of [
    [{}, {}, 503],
    [env, {}, 302],
    [env, { "oai-authenticated-user-email": "other@example.com" }, 403],
    [{ ...env, MEDIA_TRACKER_AUTH_MODE: "cloudflare-access", CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com", CF_ACCESS_AUD: "test-audience" },
      { "oai-authenticated-user-email": "owner@example.com" }, 401],
  ]) {
    const response = await worker.fetch(new Request("https://tracker.example/", { headers }), config, ctx);
    assert.equal(response.status, expected);
    assert.doesNotMatch(await response.text(), /My library|<title>/);
  }
});

test("protects every API before database access and disables the unused image proxy", async () => {
  for (const path of ["/api/media", "/api/export", "/api/collections", "/api/discover?q=sample&type=tv", "/api/security/metrics", "/api/metadata/status"]) {
    const response = await worker.fetch(new Request(`https://tracker.example${path}`), env, ctx);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const response = await worker.fetch(new Request("https://tracker.example/_vinext/image?url=http://127.0.0.1/"), env, ctx);
  assert.equal(response.status, 404);
});
