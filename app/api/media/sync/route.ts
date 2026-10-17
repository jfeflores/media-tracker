import { and, eq, inArray } from "drizzle-orm";
import { guardApiRequest, readJsonObject } from "@/app/lib/api-security";
import { syncMediaMetadata } from "@/app/lib/media-metadata";
import { getDb } from "@/db";
import { mediaItems } from "@/db/schema";
import { routeError, toMediaItem } from "../helpers";
import { recordAuditEvents, type AuditEvent } from "@/app/lib/audit";
import { mapWithConcurrency } from "@/app/lib/concurrency";
import type { MediaItem } from "@/app/lib/media";
import {
  MetadataSyncError,
  providerFailuresFrom,
  type MetadataProviderFailure,
} from "@/app/lib/metadata-provider";
import type { MetadataProviderId } from "@/app/lib/provider-health";

export const dynamic = "force-dynamic";

type SyncItemError = {
  id: string;
  error: string;
  code: string;
  providers: MetadataProviderId[];
  retryAfterAt: string | null;
};

export async function POST(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "metadata");
    if (blocked) return blocked;
    const payload = await readJsonObject(request);
    const ids = Array.isArray(payload.ids)
      ? [...new Set(payload.ids.filter((id): id is string => typeof id === "string")
        .map((id) => id.trim().slice(0, 100))
        .filter(Boolean))].slice(0, 8)
      : [];
    if (!ids.length) return Response.json({ error: "Choose at least one title to sync." }, { status: 400 });

    const db = await getDb();
    const rows = await db.select().from(mediaItems).where(inArray(mediaItems.id, ids));
    const synced: MediaItem[] = [];
    const failedItems: MediaItem[] = [];
    const errors: SyncItemError[] = [];
    const foundIds = new Set(rows.map((row) => row.id));
    for (const id of ids) {
      if (!foundIds.has(id)) errors.push({
        id,
        error: "This library item no longer exists.",
        code: "not_found",
        providers: [],
        retryAfterAt: null,
      });
    }

    // Two workers overlap independent catalog and database waits. The public
    // MyAnimeList bridge still passes through its own serialized rate limiter.
    const outcomes = await mapWithConcurrency(rows, 2, async (row) => {
      try {
        const attemptedAt = new Date().toISOString();
        const metadata = await syncMediaMetadata(row);
        const [updated] = await db.update(mediaItems)
          .set({
            ...metadata,
            metadataLastAttemptAt: attemptedAt,
            metadataLastErrorCode: null,
            metadataLastErrorProvider: null,
            metadataRetryAfterAt: null,
            updatedAt: row.updatedAt,
          })
          .where(and(eq(mediaItems.id, row.id), eq(mediaItems.updatedAt, row.updatedAt)))
          .returning();
        if (updated) return {
          item: toMediaItem(updated),
          failedItem: null,
          error: null,
          audit: { action: "metadata_synced", mediaItemId: row.id } satisfies AuditEvent,
        };
        return {
          item: null,
          failedItem: null,
          error: {
            id: row.id,
            error: "This title changed during sync. Its latest edits were preserved; try again.",
            code: "conflict",
            providers: [],
            retryAfterAt: null,
          } satisfies SyncItemError,
          audit: { action: "metadata_failed", mediaItemId: row.id } satisfies AuditEvent,
        };
      } catch (error) {
        const failures = error instanceof MetadataSyncError
          ? error.failures
          : providerFailuresFrom(error, fallbackProvider(row.type));
        const retryAfterAt = latestRetryAfter(failures);
        const code = error instanceof MetadataSyncError
          ? error.code
          : failures.some((failure) => failure.code !== "not_found")
            ? "provider_unavailable"
            : "not_found";
        const message = error instanceof MetadataSyncError
          ? error.publicMessage
          : code === "provider_unavailable"
            ? `${providerLabel(failures[0]?.provider)} is temporarily unavailable. Your saved entry was left unchanged.`
            : "No reliable metadata match was found. Try choosing a catalog result first.";
        const [failed] = await db.update(mediaItems)
          .set({
            metadataLastAttemptAt: new Date().toISOString(),
            metadataLastErrorCode: code,
            metadataLastErrorProvider: failures[0]?.provider ?? null,
            metadataRetryAfterAt: retryAfterAt,
            updatedAt: row.updatedAt,
          })
          .where(and(eq(mediaItems.id, row.id), eq(mediaItems.updatedAt, row.updatedAt)))
          .returning();
        console.error("Metadata sync failed", {
          id: row.id,
          failures: failures.map(({ provider, code: failureCode, status }) => ({
            provider,
            code: failureCode,
            status,
          })),
        });
        return {
          item: null,
          failedItem: failed ? toMediaItem(failed) : null,
          error: {
            id: row.id,
            error: message,
            code,
            providers: [...new Set(failures.map((failure) => failure.provider))],
            retryAfterAt,
          } satisfies SyncItemError,
          audit: { action: "metadata_failed", mediaItemId: row.id } satisfies AuditEvent,
        };
      }
    });

    for (const outcome of outcomes) {
      if (outcome.item) synced.push(outcome.item);
      if (outcome.failedItem) failedItems.push(outcome.failedItem);
      if (outcome.error) errors.push(outcome.error);
    }
    await recordAuditEvents(request, outcomes.map((outcome) => outcome.audit));

    return Response.json(
      { items: synced, failedItems, errors },
      { status: errors.length ? 207 : 200 },
    );
  } catch (error) {
    return routeError(error);
  }
}

function fallbackProvider(type: string): MetadataProviderId {
  if (type === "anime" || type === "manga") return "myanimelist";
  if (type === "tv") return "tvmaze";
  return "wikipedia";
}

function latestRetryAfter(failures: MetadataProviderFailure[]) {
  return failures
    .map((failure) => failure.retryAfterAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function providerLabel(provider: MetadataProviderId | undefined) {
  if (provider === "myanimelist") return "MyAnimeList";
  if (provider === "jikan") return "The MyAnimeList fallback";
  if (provider === "kitsu") return "Kitsu";
  if (provider === "anilist") return "AniList";
  if (provider === "tvmaze") return "TVmaze";
  if (provider === "wikipedia" || provider === "wikidata") return "Wikipedia metadata";
  if (provider === "imdb") return "IMDb";
  return "The metadata provider";
}
