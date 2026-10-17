import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { cleanCollectionName, sameCollectionName, toMediaCollection } from "../app/lib/collections.ts";
import { collections, mediaCollectionItems } from "../db/schema.ts";

test("normalizes collection names without changing a valid user label", () => {
  assert.equal(cleanCollectionName("  Weekend   picks  "), "Weekend picks");
  assert.equal(cleanCollectionName("   "), null);
  assert.equal(cleanCollectionName(42), null);
  assert.equal(cleanCollectionName("x".repeat(80))?.length, 60);
  assert.equal(sameCollectionName("Favorites", "favorites"), true);
});

test("maps collection rows with unique media membership", () => {
  const mapped = toMediaCollection({
    id: "custom-1",
    name: "Comfort shows",
    kind: "custom",
    filterKey: null,
    sortOrder: 8,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  }, ["media-1", "media-1", "media-2"]);

  assert.equal(mapped.kind, "custom");
  assert.deepEqual(mapped.mediaItemIds, ["media-1", "media-2"]);
});

test("database schema stores ordered collections and compact memberships", () => {
  const collectionColumns = getTableColumns(collections);
  const membershipColumns = getTableColumns(mediaCollectionItems);
  for (const name of ["name", "kind", "filterKey", "sortOrder"]) {
    assert.ok(name in collectionColumns, `${name} should be stored on collections`);
  }
  for (const name of ["collectionId", "mediaItemId"]) {
    assert.ok(name in membershipColumns, `${name} should be stored on collection membership`);
  }
});

test("collection migration is additive and preserves the media library", async () => {
  const migration = await readFile(new URL("../drizzle/0006_wandering_wallop.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `collections`/);
  assert.match(migration, /CREATE TABLE `media_collection_items`/);
  assert.match(migration, /ON DELETE cascade/);
  assert.match(migration, /collections_sort_order_idx/);
  assert.match(migration, /media_collection_items_media_idx/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM `media_items`/i);
});

test("library UI exposes explicit saved sort choices and collection membership", async () => {
  const source = await readFile(new URL("../app/components/media-tracker.tsx", import.meta.url), "utf8");
  assert.match(source, /media-tracker-sort-mode/);
  assert.match(source, /Priority · highest first/);
  assert.match(source, /Title · A–Z/);
  assert.match(source, /Manage collections/);
  assert.match(source, /\/api\/media\/\$\{item\.id\}\/collections/);
});
