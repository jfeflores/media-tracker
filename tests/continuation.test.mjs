import assert from "node:assert/strict";
import test from "node:test";
import { continuationForItem, inferCompletedScope } from "../app/lib/continuation.ts";

function series(overrides = {}) {
  return {
    type: "anime",
    status: "finished",
    progress: 12,
    totalUnits: 12,
    unitLabel: "episodes",
    completedSeasons: 1,
    completedMovies: 0,
    seasonCount: 1,
    releasedSeasonCount: 1,
    franchiseInstallments: [],
    airingStatus: "finished",
    nextAiringAt: null,
    nextAiringLabel: null,
    ...overrides,
  };
}

function installment(overrides = {}) {
  return {
    providerId: "season-2",
    title: "Season 2",
    kind: "season",
    seasonNumber: 2,
    status: "finished",
    releaseDate: "2024-01-01",
    externalUrl: null,
    ...overrides,
  };
}

test("keeps an unfinished watch session distinct from caught-up continuations", () => {
  const result = continuationForItem(series({
    type: "manga",
    status: "in_progress",
    progress: 42,
    totalUnits: 100,
    unitLabel: "chapters",
  }));
  assert.equal(result?.reason, "in_progress");
  assert.equal(result?.label, "Continue reading");
  assert.equal(result?.detail, "42 of 100 chapters");
});

test("returns a finished title when a released season is beyond the completed scope", () => {
  const result = continuationForItem(series({
    seasonCount: 2,
    releasedSeasonCount: 2,
    franchiseInstallments: [
      installment({ providerId: "season-1", title: "Season 1", seasonNumber: 1 }),
      installment(),
    ],
  }));
  assert.equal(result?.reason, "available");
  assert.equal(result?.title, "Season 2");
});

test("returns a finished title when a future season is confirmed", () => {
  const result = continuationForItem(series({
    completedSeasons: 2,
    seasonCount: 3,
    releasedSeasonCount: 2,
    franchiseInstallments: [
      installment({ providerId: "season-1", title: "Season 1", seasonNumber: 1 }),
      installment(),
      installment({
        providerId: "season-3",
        title: "Season 3",
        seasonNumber: 3,
        status: "not_yet_released",
        releaseDate: "2099-01-01",
      }),
    ],
  }));
  assert.equal(result?.reason, "announced");
  assert.equal(result?.title, "Season 3");
});

test("returns a finished anime when a related movie is confirmed beyond watched movies", () => {
  const result = continuationForItem(series({
    completedSeasons: null,
    completedMovies: 1,
    seasonCount: 0,
    releasedSeasonCount: 0,
    franchiseInstallments: [
      installment({ providerId: "movie-1", title: "First Movie", kind: "movie", seasonNumber: null }),
      installment({
        providerId: "movie-2",
        title: "Sequel Movie",
        kind: "movie",
        seasonNumber: null,
        status: "not_yet_released",
        releaseDate: "2099-01-01",
      }),
    ],
  }));
  assert.equal(result?.reason, "announced");
  assert.equal(result?.title, "Sequel Movie");
});

test("does not return a finished title that is fully caught up", () => {
  const result = continuationForItem(series({
    completedSeasons: 2,
    seasonCount: 2,
    releasedSeasonCount: 2,
    franchiseInstallments: [
      installment({ providerId: "season-1", title: "Season 1", seasonNumber: 1 }),
      installment(),
    ],
  }));
  assert.equal(result, null);
});

test("infers completed seasons and movies from imported watch-history notes", () => {
  const result = inferCompletedScope({
    type: "anime",
    status: "finished",
    notes: "What you watched: S1, S2, Movie",
    completedSeasons: null,
    completedMovies: null,
    releasedSeasonCount: 3,
    releasedMovieCount: 2,
  });
  assert.deepEqual(result, { completedSeasons: 2, completedMovies: 1 });
});

test("treats a manually finished series without history as caught up to released seasons", () => {
  const result = inferCompletedScope({
    type: "tv",
    status: "finished",
    notes: null,
    completedSeasons: null,
    completedMovies: null,
    releasedSeasonCount: 3,
    releasedMovieCount: 0,
  });
  assert.deepEqual(result, { completedSeasons: 3, completedMovies: null });
});
