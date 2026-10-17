import type { MediaCollection } from "@/app/lib/collections";
import type { MediaItem } from "@/app/lib/media";

export const MEDIA_TRACKER_BACKUP_VERSION = 1;

export type MediaTrackerBackup = {
  application: "Media Tracker";
  schemaVersion: number;
  generatedAt: string;
  summary: {
    items: number;
    customCollections: number;
  };
  items: MediaItem[];
  collections: MediaCollection[];
};

export function buildMediaTrackerBackup(
  items: MediaItem[],
  collections: MediaCollection[],
  generatedAt = new Date().toISOString(),
): MediaTrackerBackup {
  return {
    application: "Media Tracker",
    schemaVersion: MEDIA_TRACKER_BACKUP_VERSION,
    generatedAt,
    summary: {
      items: items.length,
      customCollections: collections.filter((collection) => collection.kind === "custom").length,
    },
    items,
    collections,
  };
}

const CSV_COLUMNS = [
  "id",
  "title",
  "alternate_title",
  "type",
  "status",
  "priority",
  "tier",
  "progress",
  "total_units",
  "unit_label",
  "rating",
  "review",
  "notes",
  "overview",
  "release_date",
  "reminder_date",
  "genres",
  "tags",
  "collections",
  "provider",
  "provider_id",
  "external_url",
  "poster_url",
  "community_rating",
  "rating_source",
  "imdb_id",
  "mal_id",
  "anilist_id",
  "completed_seasons",
  "completed_movies",
  "available_units",
  "airing_status",
  "next_airing_at",
  "metadata_updated_at",
  "created_at",
  "updated_at",
] as const;

export function mediaTrackerBackupToCsv(backup: MediaTrackerBackup) {
  const collectionNamesByItem = new Map<string, string[]>();
  for (const collection of backup.collections) {
    if (collection.kind !== "custom") continue;
    for (const mediaItemId of collection.mediaItemIds) {
      const names = collectionNamesByItem.get(mediaItemId) ?? [];
      names.push(collection.name);
      collectionNamesByItem.set(mediaItemId, names);
    }
  }

  const rows = backup.items.map((item) => [
    item.id,
    item.title,
    item.alternateTitle,
    item.type,
    item.status,
    item.priority,
    item.tier,
    item.progress,
    item.totalUnits,
    item.unitLabel,
    item.rating,
    item.review,
    item.notes,
    item.overview,
    item.releaseDate,
    item.reminderDate,
    item.genres.join("; "),
    item.tags.join("; "),
    (collectionNamesByItem.get(item.id) ?? []).join("; "),
    item.provider,
    item.providerId,
    item.externalUrl,
    item.posterUrl,
    item.communityRating,
    item.ratingSource,
    item.imdbId,
    item.malId,
    item.anilistId,
    item.completedSeasons,
    item.completedMovies,
    item.availableUnits,
    item.airingStatus,
    item.nextAiringAt,
    item.metadataUpdatedAt,
    item.createdAt,
    item.updatedAt,
  ]);

  return [CSV_COLUMNS, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function csvCell(value: string | number | null) {
  if (value === null) return "";
  let text = String(value);
  // Prevent provider-supplied titles or notes from becoming spreadsheet formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
