import { asc, desc } from "drizzle-orm";
import { guardApiRequest } from "@/app/lib/api-security";
import { recordAuditEvent } from "@/app/lib/audit";
import { toMediaCollection } from "@/app/lib/collections";
import { buildMediaTrackerBackup, mediaTrackerBackupToCsv } from "@/app/lib/data-export";
import { routeError, toMediaItem } from "@/app/api/media/helpers";
import { getDb } from "@/db";
import { collections, mediaCollectionItems, mediaItems } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const blocked = await guardApiRequest(request, "read");
    if (blocked) return blocked;

    const db = await getDb();
    const [itemRows, collectionRows, memberships] = await Promise.all([
      db.select().from(mediaItems).orderBy(desc(mediaItems.updatedAt), desc(mediaItems.createdAt)),
      db.select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.createdAt)),
      db.select({
        collectionId: mediaCollectionItems.collectionId,
        mediaItemId: mediaCollectionItems.mediaItemId,
      }).from(mediaCollectionItems),
    ]);

    const memberIds = new Map<string, string[]>();
    for (const membership of memberships) {
      const current = memberIds.get(membership.collectionId) ?? [];
      current.push(membership.mediaItemId);
      memberIds.set(membership.collectionId, current);
    }

    const backup = buildMediaTrackerBackup(
      itemRows.map(toMediaItem),
      collectionRows.map((row) => toMediaCollection(row, memberIds.get(row.id))),
    );
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const date = backup.generatedAt.slice(0, 10);

    await recordAuditEvent(request, format === "csv" ? "data_exported_csv" : "data_exported_json", null);

    if (format === "csv") {
      return new Response(mediaTrackerBackupToCsv(backup), {
        headers: downloadHeaders(`media-tracker-${date}.csv`, "text/csv; charset=utf-8"),
      });
    }

    return new Response(JSON.stringify(backup, null, 2), {
      headers: downloadHeaders(`media-tracker-backup-${date}.json`, "application/json; charset=utf-8"),
    });
  } catch (error) {
    return routeError(error);
  }
}

function downloadHeaders(filename: string, contentType: string) {
  return {
    "cache-control": "private, no-store",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}
