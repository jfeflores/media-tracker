import { getD1Binding } from "@/db";

export const METADATA_PROVIDER_IDS = [
  "anilist",
  "myanimelist",
  "jikan",
  "kitsu",
  "tvmaze",
  "wikipedia",
  "wikidata",
  "imdb",
] as const;

export type MetadataProviderId = (typeof METADATA_PROVIDER_IDS)[number];

export type ProviderHealthRecord = {
  provider: MetadataProviderId;
  state: "healthy" | "degraded" | "unavailable";
  consecutiveFailures: number;
  lastStatus: number | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  retryAfterAt: string | null;
  updatedAt: string;
};

type ProviderHealthRow = {
  provider: string;
  state: string;
  consecutive_failures: number;
  last_status: number | null;
  last_error_code: string | null;
  last_error_at: string | null;
  last_success_at: string | null;
  retry_after_at: string | null;
  updated_at: string;
};

export async function recordProviderSuccess(provider: MetadataProviderId) {
  try {
    const d1 = await getD1Binding();
    await d1.prepare(`INSERT INTO metadata_provider_health
      (provider, state, consecutive_failures, last_success_at, updated_at)
      VALUES (?, 'healthy', 0, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        state = 'healthy',
        consecutive_failures = 0,
        last_status = NULL,
        last_error_code = NULL,
        last_success_at = excluded.last_success_at,
        retry_after_at = NULL,
        updated_at = excluded.updated_at`)
      .bind(provider, nowIso(), nowIso())
      .run();
  } catch (error) {
    console.warn("Provider health success could not be recorded", {
      provider,
      error: safeErrorName(error),
    });
  }
}

export async function recordProviderFailure(
  provider: MetadataProviderId,
  details: {
    code: string;
    status?: number | null;
    retryAfterAt?: string | null;
    unavailable?: boolean;
  },
) {
  try {
    const d1 = await getD1Binding();
    const state = details.unavailable ? "unavailable" : "degraded";
    const timestamp = nowIso();
    await d1.prepare(`INSERT INTO metadata_provider_health
      (provider, state, consecutive_failures, last_status, last_error_code,
        last_error_at, retry_after_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        state = CASE
          WHEN excluded.state = 'unavailable' OR consecutive_failures + 1 >= 2
            THEN 'unavailable'
          ELSE 'degraded'
        END,
        consecutive_failures = consecutive_failures + 1,
        last_status = excluded.last_status,
        last_error_code = excluded.last_error_code,
        last_error_at = excluded.last_error_at,
        retry_after_at = excluded.retry_after_at,
        updated_at = excluded.updated_at`)
      .bind(
        provider,
        state,
        details.status ?? null,
        details.code.slice(0, 60),
        timestamp,
        details.retryAfterAt ?? null,
        timestamp,
      )
      .run();
  } catch (error) {
    console.warn("Provider health failure could not be recorded", {
      provider,
      error: safeErrorName(error),
    });
  }
}

export async function getProviderRetryAfter(provider: MetadataProviderId) {
  try {
    const d1 = await getD1Binding();
    const row = await d1.prepare(
      "SELECT retry_after_at FROM metadata_provider_health WHERE provider = ?",
    ).bind(provider).first<{ retry_after_at: string | null }>();
    return row?.retry_after_at ?? null;
  } catch {
    return null;
  }
}

export async function listProviderHealth(): Promise<ProviderHealthRecord[]> {
  try {
    const d1 = await getD1Binding();
    const rows = await d1.prepare(`SELECT provider, state, consecutive_failures,
      last_status, last_error_code, last_error_at, last_success_at,
      retry_after_at, updated_at
      FROM metadata_provider_health`).all<ProviderHealthRow>();
    return rows.results.flatMap((row: ProviderHealthRow) => {
      if (!METADATA_PROVIDER_IDS.includes(row.provider as MetadataProviderId)) return [];
      return [{
        provider: row.provider as MetadataProviderId,
        state: normalizeState(row.state),
        consecutiveFailures: Number(row.consecutive_failures ?? 0),
        lastStatus: row.last_status,
        lastErrorCode: row.last_error_code,
        lastErrorAt: row.last_error_at,
        lastSuccessAt: row.last_success_at,
        retryAfterAt: row.retry_after_at,
        updatedAt: row.updated_at,
      }];
    });
  } catch {
    return [];
  }
}

function normalizeState(value: string): ProviderHealthRecord["state"] {
  if (value === "healthy" || value === "degraded" || value === "unavailable") return value;
  return "degraded";
}

function nowIso() {
  return new Date().toISOString();
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}
