import { type MediaItemRow } from "@/db/schema";
import { ApiRequestError } from "@/app/lib/api-security";
import {
  MEDIA_PRIORITIES,
  MEDIA_STATUSES,
  MEDIA_TIERS,
  MEDIA_TYPES,
  parseMediaInstallments,
  parseMetadataSources,
  parseStringArray,
  type AiringStatus,
  type MediaInput,
  type MediaItem,
  type MediaPriority,
  type MediaStatus,
  type MediaTier,
  type MediaType,
} from "@/app/lib/media";

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function cleanText(value: unknown, max = 20_000): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, 2_000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password) return null;
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanNumber(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, 50))
    .filter(Boolean))].slice(0, 20);
}

export function toMediaItem(row: MediaItemRow): MediaItem {
  return {
    ...row,
    type: row.type as MediaType,
    status: row.status as MediaStatus,
    priority: row.priority as MediaPriority,
    tier: row.tier as MediaTier,
    airingStatus: row.airingStatus as AiringStatus | null,
    genres: parseStringArray(row.genres),
    tags: parseStringArray(row.tags),
    metadataSources: parseMetadataSources(row.metadataSources),
    franchiseInstallments: parseMediaInstallments(row.franchiseInstallments),
  };
}

export function parseMediaPayload(payload: Record<string, unknown>): MediaInput {
  const title = cleanText(payload.title, 300);
  if (!title) throw new Error("A title is required.");

  const type = isOneOf(payload.type, MEDIA_TYPES) ? payload.type : "tv";
  const status = isOneOf(payload.status, MEDIA_STATUSES) ? payload.status : "watchlist";
  const priority = isOneOf(payload.priority, MEDIA_PRIORITIES) ? payload.priority : "normal";
  const tier = isOneOf(payload.tier, MEDIA_TIERS) ? payload.tier : "unranked";
  const progress = Math.round(cleanNumber(payload.progress, 0, 1_000_000) ?? 0);
  const totalUnitsRaw = cleanNumber(payload.totalUnits, 0, 1_000_000);
  const totalUnits = totalUnitsRaw === null ? null : Math.round(totalUnitsRaw);
  const completedSeasonsRaw = cleanNumber(payload.completedSeasons, 0, 100);
  const completedMoviesRaw = cleanNumber(payload.completedMovies, 0, 100);

  return {
    title,
    alternateTitle: cleanText(payload.alternateTitle, 300),
    type,
    status,
    priority,
    tier,
    progress: totalUnits === null ? progress : Math.min(progress, totalUnits),
    totalUnits,
    completedSeasons: completedSeasonsRaw === null ? null : Math.round(completedSeasonsRaw),
    completedMovies: completedMoviesRaw === null ? null : Math.round(completedMoviesRaw),
    unitLabel: cleanText(payload.unitLabel, 40) ?? "episodes",
    rating: cleanNumber(payload.rating, 0, 10),
    review: cleanText(payload.review),
    notes: cleanText(payload.notes),
    overview: cleanText(payload.overview),
    posterUrl: cleanUrl(payload.posterUrl),
    backdropUrl: cleanUrl(payload.backdropUrl),
    releaseDate: cleanText(payload.releaseDate, 40),
    reminderDate: cleanText(payload.reminderDate, 40),
    genres: cleanArray(payload.genres),
    tags: cleanArray(payload.tags),
    provider: cleanText(payload.provider, 80),
    providerId: cleanText(payload.providerId, 200),
    externalUrl: cleanUrl(payload.externalUrl),
  };
}

export function rowValues(input: MediaInput) {
  return {
    ...input,
    genres: JSON.stringify(input.genres),
    tags: JSON.stringify(input.tags),
  };
}

export function routeError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message === "A title is required.") {
    return Response.json({ error: message }, { status: 400 });
  }
  console.error("Media API request failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return Response.json(
    { error: "The request could not be completed." },
    { status: 500 },
  );
}
