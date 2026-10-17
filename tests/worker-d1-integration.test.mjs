import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions, Response as FixtureResponse } from "miniflare";

// The actual built Worker runs in workerd with an actual isolated D1 binding.
// No hosting account, original database, production secret, or network provider is used.
test("Worker + D1 preserves a complete owner-only CRUD, collection and export flow", { timeout: 60_000 }, async () => {
  let upstreamUnavailable = false;
  let holdMetadata = false;
  let releaseMetadata;
  let metadataStarted;
  let metadataGate;
  const outboundService = async (request) => {
    if (new URL(request.url).hostname !== "api.tvmaze.com") return new FixtureResponse("Unexpected upstream", { status: 503 });
    if (upstreamUnavailable) return new FixtureResponse("Unavailable", { status: 504 });
    if (request.url.includes("/seasons")) return FixtureResponse.json([{ id: 101, number: 1, premiereDate: "2024-01-01", endDate: "2024-03-01" }]);
    if (holdMetadata) { metadataStarted(); await metadataGate; }
    return FixtureResponse.json({ id: 42, name: "Fictional Release Demo", status: "Ended", genres: ["Drama"],
      summary: "Fictional upstream description", rating: { average: 8 }, externals: { imdb: null },
      _embedded: { episodes: [{ season: 1, number: 1, airstamp: "2024-01-01T20:00:00Z" }] } });
  };
  const moduleRoot = fileURLToPath(new URL("../dist/server/", import.meta.url));
  const moduleNames = ["index.js", ...readdirSync(moduleRoot, { recursive: true }).filter((name) => name.endsWith(".js") && name !== "index.js")];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: moduleNames.map((name) => ({ type: "ESModule", path: resolve(moduleRoot, name) })),
    modulesRoot: moduleRoot,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    outboundService,
    bindings: {
      MEDIA_TRACKER_AUTH_MODE: "sites",
      MEDIA_TRACKER_OWNER_HASH: createHash("sha256").update("owner@example.com").digest("hex"),
    },
    log: new Log(LogLevel.ERROR),
  }));
  const send = (path, { body, method = "GET", owner = "owner@example.com", origin = "http://localhost" } = {}) => mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: { "oai-authenticated-user-email": owner, origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const denied = await send("/api/media", { owner: "other@example.com" });
    assert.equal(denied.status, 403, await denied.text());
    const empty = await send("/api/media");
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).items, []);
    const unsafe = await send("/api/media", { method: "POST", body: { title: "Unwanted", type: "tv" }, origin: "https://other.example" });
    assert.equal(unsafe.status, 403);
    const created = await send("/api/media", { method: "POST", body: { title: "Fictional Release Demo", type: "tv", notes: 'Private example note', progress: 2, totalUnits: 12, provider: "TVmaze", providerId: "42" } });
    assert.equal(created.status, 201);
    const item = (await created.json()).item;
    assert.equal(item.notes, "Private example note");
    assert.ok(item.createdAt);
    const changed = await send(`/api/media/${item.id}`, { method: "PATCH", body: { ...item, progress: 3, tier: "a" } });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).item.progress, 3);
    const synced = await send("/api/media/sync", { method: "POST", body: { ids: [item.id] } });
    assert.equal(synced.status, 200);
    const syncedData = await synced.json();
    assert.equal(syncedData.items[0].overview, "Fictional upstream description");
    assert.equal(syncedData.items[0].progress, 3);

    // Hold a real upstream response while another request edits the same row.
    holdMetadata = true;
    metadataGate = new Promise((resolve) => { releaseMetadata = resolve; });
    const started = new Promise((resolve) => { metadataStarted = resolve; });
    const pendingSync = send("/api/media/sync", { method: "POST", body: { ids: [item.id] } });
    try {
      await started;
      const edit = await send(`/api/media/${item.id}`, { method: "PATCH", body: { ...syncedData.items[0], notes: "Edited during sync", progress: 4 } });
      assert.equal(edit.status, 200);
    } finally { holdMetadata = false; releaseMetadata(); }
    const conflicted = await (await pendingSync).json();
    assert.equal(conflicted.errors[0].code, "conflict");
    upstreamUnavailable = true;
    const failure = await (await send("/api/media/sync", { method: "POST", body: { ids: [item.id] } })).json();
    assert.equal(failure.errors[0].code, "provider_unavailable");
    const preserved = await (await send(`/api/media/${item.id}`)).json();
    assert.equal(preserved.item.notes, "Edited during sync");
    assert.equal(preserved.item.progress, 4);
    assert.equal(preserved.item.overview, "Fictional upstream description");
    const collection = await send("/api/collections", { method: "POST", body: { name: "Sample Collection" } });
    assert.equal(collection.status, 201);
    const collectionId = (await collection.json()).collection.id;
    const membership = await send(`/api/media/${item.id}/collections`, { method: "PUT", body: { collectionIds: [collectionId] } });
    assert.equal(membership.status, 200);
    const backupResponse = await send("/api/export");
    assert.equal(backupResponse.status, 200);
    assert.equal(backupResponse.headers.get("cache-control"), "private, no-store");
    const backup = await backupResponse.json();
    assert.equal(backup.items.length, 1);
    assert.equal(backup.items[0].notes, "Edited during sync");
    assert.deepEqual(backup.collections.find((entry) => entry.id === collectionId).mediaItemIds, [item.id]);
    const deleted = await send(`/api/media/${item.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    const d1 = await mf.getD1Database("DB");
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM media_collection_items").first()).n, 0);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM media_items").first()).n, 0);
    assert.ok((await d1.prepare("SELECT COUNT(*) AS n FROM audit_events").first()).n >= 5);
  } finally { await mf.dispose(); }
});
