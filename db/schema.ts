import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    alternateTitle: text("alternate_title"),
    type: text("type").notNull(),
    status: text("status").notNull().default("watchlist"),
    priority: text("priority").notNull().default("normal"),
    tier: text("tier").notNull().default("unranked"),
    progress: integer("progress").notNull().default(0),
    totalUnits: integer("total_units"),
    unitLabel: text("unit_label").notNull().default("episodes"),
    rating: real("rating"),
    review: text("review"),
    notes: text("notes"),
    overview: text("overview"),
    posterUrl: text("poster_url"),
    backdropUrl: text("backdrop_url"),
    releaseDate: text("release_date"),
    reminderDate: text("reminder_date"),
    genres: text("genres").notNull().default("[]"),
    tags: text("tags").notNull().default("[]"),
    provider: text("provider"),
    providerId: text("provider_id"),
    externalUrl: text("external_url"),
    descriptionSource: text("description_source"),
    communityRating: real("community_rating"),
    ratingSource: text("rating_source"),
    ratingVotes: integer("rating_votes"),
    imdbId: text("imdb_id"),
    malId: text("mal_id"),
    anilistId: text("anilist_id"),
    metadataSources: text("metadata_sources").notNull().default("[]"),
    seasonCount: integer("season_count"),
    releasedSeasonCount: integer("released_season_count"),
    completedSeasons: integer("completed_seasons"),
    completedMovies: integer("completed_movies"),
    franchiseInstallments: text("franchise_installments").notNull().default("[]"),
    availableUnits: integer("available_units"),
    airingStatus: text("airing_status"),
    nextUnit: integer("next_unit"),
    nextAiringLabel: text("next_airing_label"),
    nextAiringAt: text("next_airing_at"),
    scheduleAlert: text("schedule_alert"),
    metadataUpdatedAt: text("metadata_updated_at"),
    metadataLastAttemptAt: text("metadata_last_attempt_at"),
    metadataLastErrorCode: text("metadata_last_error_code"),
    metadataLastErrorProvider: text("metadata_last_error_provider"),
    metadataRetryAfterAt: text("metadata_retry_after_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    index("media_items_type_idx").on(table.type),
    index("media_items_status_idx").on(table.status),
    index("media_items_updated_at_idx").on(table.updatedAt),
    index("media_items_reminder_date_idx").on(table.reminderDate),
    index("media_items_metadata_retry_idx").on(table.metadataRetryAfterAt),
  ],
);

export type MediaItemRow = typeof mediaItems.$inferSelect;
export type NewMediaItemRow = typeof mediaItems.$inferInsert;

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("custom"),
    filterKey: text("filter_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [index("collections_sort_order_idx").on(table.sortOrder)],
);

export type CollectionRow = typeof collections.$inferSelect;

export const mediaCollectionItems = sqliteTable(
  "media_collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    mediaItemId: text("media_item_id")
      .notNull()
      .references(() => mediaItems.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.mediaItemId] }),
    index("media_collection_items_media_idx").on(table.mediaItemId),
  ],
);

export const securityEvents = sqliteTable(
  "security_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    route: text("route").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (table) => [
    index("security_events_type_idx").on(table.eventType),
    index("security_events_created_at_idx").on(table.createdAt),
  ],
);

export const requestLimits = sqliteTable(
  "request_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    count: integer("count").notNull().default(1),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("request_limits_expires_at_idx").on(table.expiresAt)],
);

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const metadataProviderHealth = sqliteTable("metadata_provider_health", {
  provider: text("provider").primaryKey(),
  state: text("state").notNull().default("degraded"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastStatus: integer("last_status"),
  lastErrorCode: text("last_error_code"),
  lastErrorAt: text("last_error_at"),
  lastSuccessAt: text("last_success_at"),
  retryAfterAt: text("retry_after_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => [
  index("metadata_provider_health_state_idx").on(table.state),
  index("metadata_provider_health_retry_idx").on(table.retryAfterAt),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  mediaItemId: text("media_item_id"),
  actorHash: text("actor_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => [
  index("audit_events_action_idx").on(table.action),
  index("audit_events_created_at_idx").on(table.createdAt),
]);
