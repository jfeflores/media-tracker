import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { authorizeOwnerRequest } from "../app/lib/owner-auth.ts";

const ownerEmail = "owner@example.com";
const ownerHash = createHash("sha256").update(ownerEmail).digest("hex");

test("rejects anonymous production API requests", async () => {
  const result = await authorizeOwnerRequest(new Request("https://tracker.example/api/media"), {
    production: true,
    runtime: { MEDIA_TRACKER_AUTH_MODE: "sites" },
    expectedOwnerHash: ownerHash,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 401);
  assert.equal(result.eventType, "unauthorized");
});

test("rejects an authenticated account that is not the configured owner", async () => {
  const request = new Request("https://tracker.example/api/media", {
    headers: { "oai-authenticated-user-email": "someone-else@example.com" },
  });
  const result = await authorizeOwnerRequest(request, {
    production: true,
    runtime: { MEDIA_TRACKER_AUTH_MODE: "sites" },
    expectedOwnerHash: ownerHash,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.status, 403);
  assert.equal(result.eventType, "forbidden_user");
});

test("accepts the configured owner using normalized email comparison", async () => {
  const request = new Request("https://tracker.example/api/media", {
    headers: { "oai-authenticated-user-email": " OWNER@EXAMPLE.COM " },
  });
  const result = await authorizeOwnerRequest(request, {
    production: true,
    runtime: { MEDIA_TRACKER_AUTH_MODE: "sites" },
    expectedOwnerHash: ownerHash,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.status, 200);
  assert.equal(result.actorHash, ownerHash);
});
