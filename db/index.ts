import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export async function getD1Binding() {
  // Keep the Cloudflare-only module behind the request-time boundary so the
  // deploy artifact can be inspected by Node without evaluating this import.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error("The media database is unavailable.");
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1Binding(), { schema });
}

let schemaReady: Promise<void> | null = null;

const RUNTIME_SCHEMA_VERSION_KEY = "runtime_schema_version";
const RUNTIME_SCHEMA_VERSION = "media-tracker-2026-08-12-v3";
const MAINTENANCE_AT_KEY = "runtime_maintenance_at";
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SYSTEM_COLLECTIONS = [
  ["system-continue", "Continue watching", "continue", 0],
  ["system-in-progress", "In progress", "in_progress", 1],
  ["system-watchlist", "Watchlist", "watchlist", 2],
  ["system-finished", "Finished", "finished", 3],
  ["system-tierlist", "Tier list", "tierlist", 4],
] as const;

export async function ensureMediaSchema() {
  if (!schemaReady) {
    schemaReady = (async () => initializeMediaSchema(await getD1Binding()))().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function initializeMediaSchema(d1: Awaited<ReturnType<typeof getD1Binding>>) {
  const runtimeState = await readRuntimeState(d1);
  if (runtimeState.schemaCurrent) {
    if (runtimeState.maintenanceDue) await runMaintenance(d1);
    return;
  }

  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS media_items (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      alternate_title text,
      type text NOT NULL,
      status text DEFAULT 'watchlist' NOT NULL,
      priority text DEFAULT 'normal' NOT NULL,
      tier text DEFAULT 'unranked' NOT NULL,
      progress integer DEFAULT 0 NOT NULL,
      total_units integer,
      unit_label text DEFAULT 'episodes' NOT NULL,
      rating real,
      review text,
      notes text,
      overview text,
      poster_url text,
      backdrop_url text,
      release_date text,
      reminder_date text,
      genres text DEFAULT '[]' NOT NULL,
      tags text DEFAULT '[]' NOT NULL,
      provider text,
      provider_id text,
      external_url text,
      description_source text,
      community_rating real,
      rating_source text,
      rating_votes integer,
      imdb_id text,
      mal_id text,
      anilist_id text,
      metadata_sources text DEFAULT '[]' NOT NULL,
      season_count integer,
      released_season_count integer,
      completed_seasons integer,
      completed_movies integer,
      franchise_installments text DEFAULT '[]' NOT NULL,
      available_units integer,
      airing_status text,
      next_unit integer,
      next_airing_label text,
      next_airing_at text,
      schedule_alert text,
      metadata_updated_at text,
      metadata_last_attempt_at text,
      metadata_last_error_code text,
      metadata_last_error_provider text,
      metadata_retry_after_at text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS security_events (
      id text PRIMARY KEY NOT NULL,
      event_type text NOT NULL,
      route text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS collections (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      kind text DEFAULT 'custom' NOT NULL,
      filter_key text,
      sort_order integer DEFAULT 0 NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS media_collection_items (
      collection_id text NOT NULL,
      media_item_id text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      PRIMARY KEY (collection_id, media_item_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS request_limits (
      bucket_key text PRIMARY KEY NOT NULL,
      count integer DEFAULT 1 NOT NULL,
      expires_at integer NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS app_metadata (
      key text PRIMARY KEY NOT NULL,
      value text NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS metadata_provider_health (
      provider text PRIMARY KEY NOT NULL,
      state text DEFAULT 'degraded' NOT NULL,
      consecutive_failures integer DEFAULT 0 NOT NULL,
      last_status integer,
      last_error_code text,
      last_error_at text,
      last_success_at text,
      retry_after_at text,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id text PRIMARY KEY NOT NULL,
      action text NOT NULL,
      media_item_id text,
      actor_hash text NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
    )`),
  ]);

  const mediaColumns = await d1.prepare("PRAGMA table_info(media_items)").all<{ name: string }>();
  if (!mediaColumns.results.some((column: { name: string }) => column.name === "tier")) {
    await d1.prepare("ALTER TABLE media_items ADD COLUMN tier text DEFAULT 'unranked' NOT NULL").run();
  }
  const metadataColumns = [
    ["description_source", "text"],
    ["community_rating", "real"],
    ["rating_source", "text"],
    ["rating_votes", "integer"],
    ["imdb_id", "text"],
    ["mal_id", "text"],
    ["anilist_id", "text"],
    ["season_count", "integer"],
    ["released_season_count", "integer"],
    ["completed_seasons", "integer"],
    ["completed_movies", "integer"],
    ["available_units", "integer"],
    ["airing_status", "text"],
    ["next_unit", "integer"],
    ["next_airing_label", "text"],
    ["next_airing_at", "text"],
    ["schedule_alert", "text"],
    ["metadata_updated_at", "text"],
    ["metadata_last_attempt_at", "text"],
    ["metadata_last_error_code", "text"],
    ["metadata_last_error_provider", "text"],
    ["metadata_retry_after_at", "text"],
  ] as const;
  for (const [name, type] of metadataColumns) {
    if (!mediaColumns.results.some((column: { name: string }) => column.name === name)) {
      await d1.prepare(`ALTER TABLE media_items ADD COLUMN ${name} ${type}`).run();
    }
  }
  if (!mediaColumns.results.some((column: { name: string }) => column.name === "metadata_sources")) {
    await d1.prepare("ALTER TABLE media_items ADD COLUMN metadata_sources text DEFAULT '[]' NOT NULL").run();
  }
  if (!mediaColumns.results.some((column: { name: string }) => column.name === "franchise_installments")) {
    await d1.prepare("ALTER TABLE media_items ADD COLUMN franchise_installments text DEFAULT '[]' NOT NULL").run();
  }

  await d1.batch([
    d1.prepare("CREATE INDEX IF NOT EXISTS media_items_type_idx ON media_items (type)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS media_items_status_idx ON media_items (status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS media_items_updated_at_idx ON media_items (updated_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS media_items_reminder_date_idx ON media_items (reminder_date)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS media_items_metadata_retry_idx ON media_items (metadata_retry_after_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS collections_sort_order_idx ON collections (sort_order)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS media_collection_items_media_idx ON media_collection_items (media_item_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS security_events_type_idx ON security_events (event_type)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON security_events (created_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS request_limits_expires_at_idx ON request_limits (expires_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS metadata_provider_health_state_idx ON metadata_provider_health (state)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS metadata_provider_health_retry_idx ON metadata_provider_health (retry_after_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at)"),
  ]);

  const insertSystemCollection = d1.prepare(`INSERT INTO collections
    (id, name, kind, filter_key, sort_order) VALUES (?, ?, 'system', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = 'system',
      filter_key = excluded.filter_key`);
  await d1.batch(SYSTEM_COLLECTIONS.map(([id, name, filterKey, sortOrder]) => (
    insertSystemCollection.bind(id, name, filterKey, sortOrder)
  )));

  await runMaintenance(d1);
  await d1.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(RUNTIME_SCHEMA_VERSION_KEY, RUNTIME_SCHEMA_VERSION)
    .run();
}

async function readRuntimeState(d1: Awaited<ReturnType<typeof getD1Binding>>) {
  try {
    const rows = await d1.prepare(
      "SELECT key, value FROM app_metadata WHERE key IN (?, ?)",
    ).bind(RUNTIME_SCHEMA_VERSION_KEY, MAINTENANCE_AT_KEY)
      .all() as { results: Array<{ key: string; value: string }> };
    const values = new Map<string, string>(rows.results.map((row) => [row.key, row.value]));
    const maintenanceAt = Date.parse(values.get(MAINTENANCE_AT_KEY) ?? "");
    return {
      schemaCurrent: values.get(RUNTIME_SCHEMA_VERSION_KEY) === RUNTIME_SCHEMA_VERSION,
      maintenanceDue: !Number.isFinite(maintenanceAt)
        || Date.now() - maintenanceAt >= MAINTENANCE_INTERVAL_MS,
    };
  } catch {
    // Fresh databases do not have app_metadata yet. The full initializer below
    // remains the safe fallback for previews and first deployments.
    return { schemaCurrent: false, maintenanceDue: true };
  }
}

async function runMaintenance(d1: Awaited<ReturnType<typeof getD1Binding>>) {
  await d1.batch([
    d1.prepare("DELETE FROM request_limits WHERE expires_at < ?")
      .bind(Math.floor(Date.now() / 1000) - 300),
    d1.prepare("DELETE FROM security_events WHERE julianday(created_at) < julianday('now', '-90 days')"),
    d1.prepare("DELETE FROM audit_events WHERE julianday(created_at) < julianday('now', '-180 days')"),
  ]);
  await d1.prepare(`INSERT INTO app_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(MAINTENANCE_AT_KEY, new Date().toISOString())
    .run();
}

export const __initializeMediaSchemaForTests = initializeMediaSchema;
export const __runtimeSchemaVersionForTests = RUNTIME_SCHEMA_VERSION;
