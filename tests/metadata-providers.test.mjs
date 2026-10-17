import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetMetadataProviderStateForTests,
  fetchProviderJson,
  MetadataProviderError,
} from "../app/lib/metadata-provider.ts";
import { searchMyAnimeList } from "../app/lib/myanimelist.ts";
import { bestKitsuBundle, searchKitsu } from "../app/lib/kitsu.ts";
import { syncMediaMetadata } from "../app/lib/media-metadata.ts";

test("uses the official MyAnimeList client as the primary anime catalog", async () => {
  const previousFetch = globalThis.fetch;
  const previousClientId = process.env.MYANIMELIST_CLIENT_ID;
  let calls = 0;
  try {
    __resetMetadataProviderStateForTests();
    process.env.MYANIMELIST_CLIENT_ID = "test-client";
    globalThis.fetch = async (url) => {
      calls += 1;
      assert.match(String(url), /^https:\/\/api\.myanimelist\.net\/v2\/anime\?/);
      return Response.json({
        data: [{
          node: {
            id: 31240,
            title: "Sample Anime Original",
            alternative_titles: { en: "Sample Anime" },
            synopsis: "A fictional catalog synopsis used for tests.",
            mean: 8.2,
            num_scoring_users: 1000,
            num_episodes: 25,
            status: "finished_airing",
          },
        }],
      });
    };

    const results = await searchMyAnimeList("Sample Anime", "anime");
    assert.equal(calls, 1, "a healthy direct MAL response should not call Jikan");
    assert.equal(results[0]?.sourceName, "MyAnimeList");
    assert.equal(results[0]?.id, 31240);
    assert.equal(results[0]?.totalUnits, 25);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousClientId === undefined) delete process.env.MYANIMELIST_CLIENT_ID;
    else process.env.MYANIMELIST_CLIENT_ID = previousClientId;
    __resetMetadataProviderStateForTests();
  }
});

test("retries a transient provider response and records a typed outage", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("Unavailable", { status: 504 });
    };
    await assert.rejects(
      fetchProviderJson("jikan", "https://api.jikan.moe/v4/anime?q=test", undefined, {
        attempts: 2,
        timeoutMs: 500,
      }),
      (error) => {
        assert.ok(error instanceof MetadataProviderError);
        assert.equal(error.failure.provider, "jikan");
        assert.equal(error.failure.code, "upstream_unavailable");
        assert.equal(error.failure.status, 504);
        return true;
      },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});

test("uses Kitsu as a credential-free emergency catalog", async () => {
  const previousFetch = globalThis.fetch;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async (url) => {
      assert.match(String(url), /^https:\/\/kitsu\.io\/api\/edge\/anime\?/);
      return Response.json({
        data: [{
          id: "11209",
          attributes: {
            slug: "sample-anime",
            canonicalTitle: "Sample Anime Original",
            titles: { en: "Sample Anime" },
            synopsis: "A fictional catalog synopsis used for tests.",
            averageRating: "82.08",
            userCount: 154023,
            startDate: "2016-04-04",
            status: "finished",
            episodeCount: 25,
            posterImage: { original: "https://media.kitsu.app/poster.jpg" },
          },
        }],
      });
    };
    const results = await searchKitsu("Sample Anime", "anime");
    assert.equal(results[0]?.sourceName, "Kitsu");
    assert.equal(results[0]?.totalUnits, 25);
    assert.equal(results[0]?.communityRating, 8.208);
    assert.match(results[0]?.externalUrl ?? "", /^https:\/\/kitsu\.app\/anime\//);
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});

test("builds released and announced anime seasons from Kitsu lineage", async () => {
  const previousFetch = globalThis.fetch;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async (url) => {
      assert.equal(new URL(String(url)).searchParams.get("include"), "mediaRelationships.destination");
      return Response.json({
        data: [
          {
            id: "season-1",
            type: "anime",
            attributes: { canonicalTitle: "Sample Show", subtype: "TV", status: "finished", startDate: "2020-01-01" },
            relationships: { mediaRelationships: { data: [{ id: "rel-12", type: "mediaRelationships" }] } },
          },
          {
            id: "season-2",
            type: "anime",
            attributes: { canonicalTitle: "Sample Show Season 2", subtype: "TV", status: "finished", startDate: "2022-01-01" },
            relationships: { mediaRelationships: { data: [{ id: "rel-23", type: "mediaRelationships" }] } },
          },
          {
            id: "season-3",
            type: "anime",
            attributes: { canonicalTitle: "Sample Show 3rd Season", subtype: "TV", status: "tba", startDate: null },
          },
        ],
        included: [
          {
            id: "rel-12",
            type: "mediaRelationships",
            attributes: { role: "sequel" },
            relationships: { destination: { data: { id: "season-2", type: "anime" } } },
          },
          {
            id: "rel-23",
            type: "mediaRelationships",
            attributes: { role: "sequel" },
            relationships: { destination: { data: { id: "season-3", type: "anime" } } },
          },
        ],
      });
    };

    const bundle = await bestKitsuBundle("Sample Show", "anime");
    assert.equal(bundle?.installments.length, 3);
    assert.deepEqual(bundle?.installments.map((item) => item.seasonNumber), [1, 2, 3]);
    assert.equal(bundle?.installments.at(-1)?.status, "not_yet_released");
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});

test("uses TVmaze's season endpoint to keep a confirmed future TV season", async () => {
  const previousFetch = globalThis.fetch;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async (url) => {
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
          _embedded: {
            episodes: [{ season: 1, number: 1, airdate: "2024-01-01", airstamp: "2024-01-01T20:00:00Z" }],
          },
        });
      }
      if (endpoint.endsWith("/shows/42/seasons")) {
        return Response.json([
          { id: 101, number: 1, name: "Season 1", premiereDate: "2024-01-01", endDate: "2024-03-01" },
          { id: 102, number: 2, name: "Season 2", premiereDate: null, endDate: null },
        ]);
      }
      throw new Error(`Unexpected provider request: ${endpoint}`);
    };

    const metadata = await syncMediaMetadata({
      id: "sample-tv",
      title: "Sample Series",
      type: "tv",
      status: "finished",
      provider: "TVmaze",
      providerId: "42",
      notes: "What you watched: S1",
      genres: "[]",
      metadataSources: "[]",
      franchiseInstallments: "[]",
      totalUnits: null,
      completedSeasons: null,
      completedMovies: null,
      releasedSeasonCount: null,
      metadataUpdatedAt: null,
    });
    assert.equal(metadata.seasonCount, 2);
    assert.equal(metadata.releasedSeasonCount, 1);
    assert.equal(metadata.completedSeasons, 1);
    assert.equal(JSON.parse(metadata.franchiseInstallments)[1]?.status, "not_yet_released");
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});

test("opens a circuit after a forbidden provider response", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    __resetMetadataProviderStateForTests();
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("Forbidden", { status: 403 });
    };
    await assert.rejects(
      fetchProviderJson("anilist", "https://graphql.anilist.co", undefined, { attempts: 1 }),
      (error) => error instanceof MetadataProviderError && error.failure.code === "forbidden",
    );
    await assert.rejects(
      fetchProviderJson("anilist", "https://graphql.anilist.co", undefined, { attempts: 1 }),
      (error) => error instanceof MetadataProviderError && error.failure.code === "circuit_open",
    );
    assert.equal(calls, 1, "an open circuit should prevent another upstream request");
  } finally {
    globalThis.fetch = previousFetch;
    __resetMetadataProviderStateForTests();
  }
});
