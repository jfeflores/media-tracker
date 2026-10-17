import { guardApiRequest } from "@/app/lib/api-security";
import { getMyAnimeListMode } from "@/app/lib/myanimelist";
import { isImdbConfigured } from "@/app/lib/imdb";
import { listProviderHealth, type MetadataProviderId, type ProviderHealthRecord } from "@/app/lib/provider-health";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = await guardApiRequest(request, "read");
  if (blocked) return blocked;
  const [malMode, imdbConfigured, healthRows] = await Promise.all([
    getMyAnimeListMode(),
    isImdbConfigured(),
    listProviderHealth(),
  ]);
  const health = new Map(healthRows.map((row) => [row.provider, row]));
  return Response.json({
    providers: [
      providerStatus(
        "anilist",
        "AniList",
        "Optional airing schedules and season links",
        health.get("anilist"),
        "unverified",
      ),
      {
        id: "myanimelist",
        label: "MyAnimeList",
        state: malMode === "direct"
          ? healthState(health.get("myanimelist"), "connected")
          : "setup_required",
        detail: malMode === "direct"
          ? healthDetail("Primary catalog, descriptions, artwork, and ratings", health.get("myanimelist"))
          : "Set MYANIMELIST_CLIENT_ID in this Site’s production environment to enable the direct catalog",
        lastCheckedAt: health.get("myanimelist")?.updatedAt ?? null,
      },
      providerStatus(
        "jikan",
        "MAL fallback",
        "Read-only MyAnimeList bridge used only when the direct client is unavailable",
        health.get("jikan"),
        "bridge",
      ),
      providerStatus(
        "kitsu",
        "Kitsu backup",
        "Anime season and movie lineage, plus emergency catalog coverage",
        health.get("kitsu"),
        "unverified",
      ),
      providerStatus(
        "tvmaze",
        "TVmaze",
        "Complete TV season lists, episodes, schedules, descriptions, and IMDb IDs",
        health.get("tvmaze"),
        "unverified",
      ),
      providerStatus(
        "wikipedia",
        "Wikipedia",
        "Movie and game descriptions, images, and Wikidata IDs",
        health.get("wikipedia"),
        "unverified",
      ),
      {
        id: "imdb",
        label: "IMDb",
        state: imdbConfigured
          ? healthState(health.get("imdb"), "connected")
          : "setup_required",
        detail: imdbConfigured
          ? healthDetail(
            "Licensed plots, ratings, genres, runtimes, and release dates",
            health.get("imdb"),
          )
          : "Matched title links; licensed AWS Data Exchange API connection required for IMDb metadata",
        lastCheckedAt: health.get("imdb")?.updatedAt ?? null,
      },
    ],
  }, { headers: { "cache-control": "private, no-store" } });
}

type ProviderUiState =
  | "connected"
  | "bridge"
  | "unverified"
  | "degraded"
  | "unavailable"
  | "setup_required";

function providerStatus(
  id: MetadataProviderId,
  label: string,
  detail: string,
  health: ProviderHealthRecord | undefined,
  fallback: ProviderUiState,
) {
  return {
    id,
    label,
    state: healthState(health, fallback),
    detail: healthDetail(detail, health),
    lastCheckedAt: health?.updatedAt ?? null,
  };
}

function healthState(
  health: ProviderHealthRecord | undefined,
  fallback: ProviderUiState,
): ProviderUiState {
  if (!health) return fallback;
  if (health.state === "healthy") return fallback === "bridge" ? "bridge" : "connected";
  return health.state;
}

function healthDetail(detail: string, health: ProviderHealthRecord | undefined) {
  if (!health) return `${detail} · not checked yet`;
  if (health.state === "healthy") return `${detail} · healthy`;
  if (health.state === "degraded") return `${detail} · recent failures, retrying carefully`;
  const status = health.lastStatus ? `HTTP ${health.lastStatus}` : health.lastErrorCode?.replaceAll("_", " ");
  return `${detail} · temporarily unavailable${status ? ` (${status})` : ""}`;
}
