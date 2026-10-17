import assert from "node:assert/strict";
import test from "node:test";
import {
  __initializeMediaSchemaForTests,
  __runtimeSchemaVersionForTests,
} from "../db/index.ts";
import { mapWithConcurrency } from "../app/lib/concurrency.ts";
import { syncMediaMetadata } from "../app/lib/media-metadata.ts";
import { __resetMetadataProviderStateForTests } from "../app/lib/metadata-provider.ts";

test("uses the schema readiness marker to avoid cold-start DDL on a current database", async () => {
  const statements = [];
  let batches = 0;
  const d1 = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async all() {
          return {
            results: [
              { key: "runtime_schema_version", value: __runtimeSchemaVersionForTests },
              { key: "runtime_maintenance_at", value: new Date().toISOString() },
            ],
          };
        },
      };
    },
    async batch() {
      batches += 1;
      return [];
    },
  };

  await __initializeMediaSchemaForTests(d1);
  assert.equal(statements.length, 1, "a current database should need one readiness read");
  assert.match(statements[0], /FROM app_metadata/);
  assert.equal(batches, 0, "current schemas should skip table and index creation");
});

test("bounded concurrency overlaps work without changing result order", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 12 : 2));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("deduplicates identical in-flight metadata syncs", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async (url) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      const endpoint = String(url);
      if (endpoint.endsWith("/shows/42?embed=episodes")) {
        return Response.json({
          id: 42,
          name: "Sample Series",
          status: "Running",
          premiered: "2024-01-01",
          genres: ["Drama"],
          summary: "A sample series.",
          rating: { average: 8 },
          externals: { imdb: null },
          _embedded: { episodes: [] },
        });
      }
      if (endpoint.endsWith("/shows/42/seasons")) return Response.json([]);
      throw new Error(`Unexpected provider request: ${endpoint}`);
    };
    const row = {
      id: "same-tv-row",
      title: "Sample Series",
      type: "tv",
      status: "finished",
      provider: "TVmaze",
      providerId: "42",
      notes: null,
      genres: "[]",
      metadataSources: "[]",
      franchiseInstallments: "[]",
      totalUnits: null,
      completedSeasons: null,
      completedMovies: null,
      releasedSeasonCount: null,
      metadataUpdatedAt: null,
    };

    const [first, second] = await Promise.all([
      syncMediaMetadata(row),
      syncMediaMetadata(row),
    ]);
    assert.deepEqual(second, first);
    assert.equal(calls, 2, "the shared sync should make one show request and one seasons request");
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});
