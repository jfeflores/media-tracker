import assert from "node:assert/strict";
import test from "node:test";
import { getImdbMetadata, isImdbConfigured } from "../app/lib/imdb.ts";

const IMDB_ENV_KEYS = [
  "IMDB_AWS_ACCESS_KEY_ID",
  "IMDB_AWS_SECRET_ACCESS_KEY",
  "IMDB_AWS_SESSION_TOKEN",
  "IMDB_DATA_SET_ID",
  "IMDB_DATASET_ID",
  "IMDB_REVISION_ID",
  "IMDB_ASSET_ID",
  "IMDB_API_KEY",
];

test("keeps the licensed IMDb adapter dormant without a complete runtime configuration", async () => {
  const previous = new Map(IMDB_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of IMDB_ENV_KEYS) delete process.env[key];
    assert.equal(await isImdbConfigured(), false);
    assert.equal(await getImdbMetadata("tt0133093"), null);
    assert.equal(await getImdbMetadata("not-an-imdb-id"), null);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
