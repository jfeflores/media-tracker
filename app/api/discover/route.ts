import type { DiscoveryResult, MediaType } from "@/app/lib/media";
import { fetchProviderJson } from "@/app/lib/metadata-provider";
import { MEDIA_TYPES } from "@/app/lib/media";
import { guardApiRequest } from "@/app/lib/api-security";
import { searchMyAnimeList, type MyAnimeListMetadata } from "@/app/lib/myanimelist";
import { searchKitsu, type KitsuMetadata } from "@/app/lib/kitsu";

export const dynamic = "force-dynamic";

function stripMarkup(value: string | null | undefined): string | null {
  if (!value) return null;
  const plain = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return plain ? plain.slice(0, 1_500) : null;
}

async function searchAnimeCatalog(query: string, type: "anime" | "manga"): Promise<DiscoveryResult[]> {
  let entries: Array<MyAnimeListMetadata | KitsuMetadata>;
  try {
    entries = await searchMyAnimeList(query, type);
    if (!entries.length) entries = await searchKitsu(query, type);
  } catch {
    entries = await searchKitsu(query, type);
  }
  return entries.map((entry) => ({
    key: `${entry.sourceName}-${type}-${entry.id}`,
    provider: entry.sourceName,
    providerId: String(entry.id),
    type,
    title: entry.title,
    alternateTitle: entry.alternateTitle,
    overview: entry.description,
    posterUrl: entry.posterUrl,
    backdropUrl: entry.backdropUrl,
    releaseDate: entry.releaseDate,
    totalUnits: entry.totalUnits,
    unitLabel: type === "anime" ? "episodes" : "chapters",
    genres: entry.genres,
    externalUrl: entry.externalUrl,
    meta: [
      entry.mediaLabel,
      entry.communityRating !== null ? `${entry.sourceName} ${entry.communityRating.toFixed(1)}` : null,
      entry.status.replaceAll("_", " "),
    ].filter(Boolean).join(" · ") || null,
  }));
}

async function searchTvMaze(query: string): Promise<DiscoveryResult[]> {
  const data = await fetchProviderJson<Array<{
    show: {
      id: number;
      name: string;
      premiered?: string | null;
      genres?: string[];
      summary?: string | null;
      image?: { medium?: string | null; original?: string | null } | null;
      url?: string | null;
      status?: string | null;
      language?: string | null;
    };
  }>>("tvmaze", `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  return data.slice(0, 8).map(({ show }) => ({
    key: `tvmaze-${show.id}`,
    provider: "TVmaze",
    providerId: String(show.id),
    type: "tv",
    title: show.name,
    alternateTitle: null,
    overview: stripMarkup(show.summary),
    posterUrl: show.image?.original ?? show.image?.medium ?? null,
    backdropUrl: null,
    releaseDate: show.premiered ?? null,
    totalUnits: null,
    unitLabel: "episodes",
    genres: show.genres ?? [],
    externalUrl: show.url ?? null,
    meta: [show.language, show.status].filter(Boolean).join(" · ") || null,
  }));
}

async function searchWikipedia(query: string, type: "movie" | "game"): Promise<DiscoveryResult[]> {
  const qualifier = type === "movie" ? "film" : "video game";
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} ${qualifier}`,
    gsrlimit: "8",
    prop: "pageimages|extracts|info",
    piprop: "thumbnail|original",
    pithumbsize: "700",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*",
  });
  const data = await fetchProviderJson<{
    query?: { pages?: Record<string, {
      pageid: number;
      title: string;
      extract?: string;
      fullurl?: string;
      thumbnail?: { source?: string };
      original?: { source?: string };
    }> };
  }>("wikipedia", `https://en.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: { "user-agent": "MediaTracker/1.0 (open-source media library)" },
  });
  return Object.values(data.query?.pages ?? {}).slice(0, 8).map((page) => ({
    key: `wikipedia-${page.pageid}`,
    provider: "Wikipedia",
    providerId: String(page.pageid),
    type,
    title: page.title.replace(/\s*\((film|video game|\d{4} film)\)$/i, ""),
    alternateTitle: page.title,
    overview: stripMarkup(page.extract),
    posterUrl: page.original?.source ?? page.thumbnail?.source ?? null,
    backdropUrl: null,
    releaseDate: null,
    totalUnits: type === "game" ? 100 : null,
    unitLabel: type === "game" ? "percent" : "minutes",
    genres: [],
    externalUrl: page.fullurl ?? null,
    meta: type === "movie" ? "Film result" : "Game result",
  }));
}

export async function GET(request: Request) {
  const blocked = await guardApiRequest(request, "discover");
  if (blocked) return blocked;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const rawType = url.searchParams.get("type");
  const type = MEDIA_TYPES.includes(rawType as MediaType) ? rawType as MediaType : null;
  if (!query || query.length < 2 || !type) {
    return Response.json({ results: [] });
  }

  try {
    const results = type === "anime" || type === "manga"
      ? await searchAnimeCatalog(query, type)
      : type === "tv"
        ? await searchTvMaze(query)
        : await searchWikipedia(query, type);
    return Response.json({ results });
  } catch (error) {
    console.error("Media discovery failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json(
      { results: [], error: "Automatic search is temporarily unavailable." },
      { status: 502 },
    );
  }
}
