import type { MediaItemRow } from "../../db/schema.ts";
import { parseMediaInstallments, type AiringStatus, type MediaInstallment, type MetadataSource } from "./media.ts";
import { bestMyAnimeListMatch } from "./myanimelist.ts";
import { bestKitsuBundle } from "./kitsu.ts";
import { getImdbMetadata } from "./imdb.ts";
import { inferCompletedScope, releasedInstallmentCount } from "./continuation.ts";
import {
  fetchProviderJson,
  MetadataProviderError,
  MetadataSyncError,
  notFoundFailure,
  providerFailuresFrom,
  recordInvalidProviderResponse,
} from "./metadata-provider.ts";
import type { MetadataProviderId } from "./provider-health.ts";

type MetadataUpdate = {
  alternateTitle: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  totalUnits: number | null;
  genres: string;
  provider: string;
  providerId: string;
  externalUrl: string | null;
  descriptionSource: string | null;
  communityRating: number | null;
  ratingSource: string | null;
  ratingVotes: number | null;
  imdbId: string | null;
  malId: string | null;
  anilistId: string | null;
  metadataSources: string;
  seasonCount: number | null;
  releasedSeasonCount: number | null;
  completedSeasons: number | null;
  completedMovies: number | null;
  franchiseInstallments: string;
  availableUnits: number | null;
  airingStatus: AiringStatus | null;
  nextUnit: number | null;
  nextAiringLabel: string | null;
  nextAiringAt: string | null;
  scheduleAlert: string | null;
  metadataUpdatedAt: string;
};

type AniRelationNode = {
  id: number;
  type?: string | null;
  format?: string | null;
  title?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
  status?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  siteUrl?: string | null;
  relations?: { edges?: AniRelationEdge[] | null } | null;
};

type AniRelationEdge = {
  relationType?: string | null;
  node?: AniRelationNode | null;
};

type AniMedia = AniRelationNode & {
  idMal?: number | null;
  title: { english?: string | null; romaji?: string | null; native?: string | null };
  description?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  bannerImage?: string | null;
  genres?: string[] | null;
  status?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  episodes?: number | null;
  chapters?: number | null;
  averageScore?: number | null;
  siteUrl?: string | null;
  nextAiringEpisode?: { airingAt?: number | null; episode?: number | null } | null;
  externalLinks?: Array<{ site?: string | null; url?: string | null }> | null;
};

type TvMazeEpisode = {
  season?: number | null;
  number?: number | null;
  airdate?: string | null;
  airstamp?: string | null;
};

type TvMazeShow = {
  id: number;
  name: string;
  premiered?: string | null;
  genres?: string[];
  summary?: string | null;
  image?: { medium?: string | null; original?: string | null } | null;
  url?: string | null;
  status?: string | null;
  rating?: { average?: number | null } | null;
  externals?: { imdb?: string | null } | null;
  _embedded?: { episodes?: TvMazeEpisode[] };
};

type TvMazeSeason = {
  id: number;
  url?: string | null;
  number?: number | null;
  name?: string | null;
  episodeOrder?: number | null;
  premiereDate?: string | null;
  endDate?: string | null;
};

type WikipediaPage = {
  pageid: number;
  title: string;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source?: string };
  original?: { source?: string };
  pageprops?: { wikibase_item?: string };
};

const ANILIST_URL = "https://graphql.anilist.co";
const SHOW_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);
const inFlightMetadataSyncs = new Map<string, Promise<MetadataUpdate>>();

export async function syncMediaMetadata(row: MediaItemRow): Promise<MetadataUpdate> {
  const key = `${row.id}:${JSON.stringify(row)}`;
  const existing = inFlightMetadataSyncs.get(key);
  if (existing) return existing;

  const pending = performMetadataSync(row);
  inFlightMetadataSyncs.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightMetadataSyncs.get(key) === pending) inFlightMetadataSyncs.delete(key);
  }
}

async function performMetadataSync(row: MediaItemRow): Promise<MetadataUpdate> {
  let metadata: MetadataUpdate;
  if (row.type === "anime" || row.type === "manga") metadata = await syncAniListAndMyAnimeList(row);
  else if (row.type === "tv") metadata = await syncTvMaze(row);
  else if (row.type === "movie" || row.type === "game") metadata = await syncWikipedia(row);
  else throw new Error("This media type does not have a metadata provider.");
  return enrichWithImdb(row, metadata);
}

async function enrichWithImdb(row: MediaItemRow, metadata: MetadataUpdate): Promise<MetadataUpdate> {
  const imdbId = validImdbId(metadata.imdbId);
  if (!imdbId) return metadata;
  let imdb;
  try {
    imdb = await getImdbMetadata(imdbId);
  } catch {
    console.warn("IMDb enrichment was unavailable; fallback metadata was preserved.");
    return metadata;
  }
  if (!imdb) return metadata;
  const existingSources = parseMetadataSources(metadata.metadataSources);
  const sources = compactSources([
    ...existingSources,
    { name: "IMDb", url: imdb.externalUrl, role: "identifier" },
    { name: "IMDb", url: imdb.externalUrl, role: "catalog" },
    imdb.description ? { name: "IMDb", url: imdb.externalUrl, role: "description" } : null,
    imdb.communityRating !== null ? { name: "IMDb", url: imdb.externalUrl, role: "rating" } : null,
  ]);
  const originalTitle = imdb.originalTitle
    && normalizeTitle(imdb.originalTitle) !== normalizeTitle(row.title)
    ? imdb.originalTitle
    : null;
  return {
    ...metadata,
    alternateTitle: originalTitle ?? metadata.alternateTitle,
    overview: imdb.description ?? metadata.overview,
    releaseDate: imdb.releaseDate ?? metadata.releaseDate,
    totalUnits: row.type === "movie" && metadata.totalUnits === null
      ? imdb.runtimeMinutes
      : metadata.totalUnits,
    genres: JSON.stringify(mergeStringArrays(parseStringArray(metadata.genres), imdb.genres)),
    descriptionSource: imdb.description ? "IMDb" : metadata.descriptionSource,
    communityRating: imdb.communityRating ?? metadata.communityRating,
    ratingSource: imdb.communityRating !== null ? "IMDb" : metadata.ratingSource,
    ratingVotes: imdb.ratingVotes ?? metadata.ratingVotes,
    imdbId,
    metadataSources: JSON.stringify(sources),
  };
}

async function syncAniListAndMyAnimeList(row: MediaItemRow): Promise<MetadataUpdate> {
  const type = row.type === "manga" ? "manga" : "anime";
  const knownMalId = row.malId
    ?? (row.provider?.startsWith("MyAnimeList") ? row.providerId : null);
  const knownKitsuId = row.provider === "Kitsu" ? row.providerId : null;
  const [aniResult, malResult, kitsuResult] = await Promise.allSettled([
    findAniListMedia(row, type),
    bestMyAnimeListMatch(row.title, type, knownMalId),
    bestKitsuBundle(row.title, type, knownKitsuId),
  ]);
  const media = aniResult.status === "fulfilled" ? aniResult.value : null;
  const mal = malResult.status === "fulfilled" ? malResult.value : null;
  const kitsuBundle = kitsuResult.status === "fulfilled" ? kitsuResult.value : null;
  const kitsu = kitsuBundle?.metadata ?? null;
  const catalog = mal ?? kitsu;
  if (!media && !catalog) {
    const failures = [
      ...(aniResult.status === "rejected"
        ? providerFailuresFrom(aniResult.reason, "anilist")
        : [notFoundFailure("anilist")]),
      ...(malResult.status === "rejected"
        ? providerFailuresFrom(malResult.reason, "myanimelist")
        : [notFoundFailure("myanimelist")]),
      ...(kitsuResult.status === "rejected"
        ? providerFailuresFrom(kitsuResult.reason, "kitsu")
        : [notFoundFailure("kitsu")]),
    ];
    throw new MetadataSyncError(failures);
  }

  const nextUnit = type === "anime" ? media?.nextAiringEpisode?.episode ?? null : null;
  const nextAiringAt = type === "anime"
    ? unixToIso(media?.nextAiringEpisode?.airingAt ?? null)
    : null;
  const nextAiringLabel = nextUnit ? `Episode ${nextUnit}` : null;
  const airingStatus = media ? aniListStatus(media.status) : catalog?.status ?? "unknown";
  const providerUnits = type === "anime" ? media?.episodes : media?.chapters;
  const syncedProviderUnits = catalog?.totalUnits ?? providerUnits ?? null;
  const totalUnits = row.metadataUpdatedAt
    ? syncedProviderUnits ?? row.totalUnits
    : row.totalUnits ?? syncedProviderUnits;
  const availableUnits = nextUnit
    ? Math.max(0, nextUnit - 1)
    : airingStatus === "finished"
      ? totalUnits
      : row.availableUnits;
  const aniDescription = stripMarkup(media?.description);
  const overview = catalog?.description ?? aniDescription ?? row.overview;
  const descriptionSource = catalog?.description
    ? catalog.sourceName
    : aniDescription
      ? "AniList"
      : row.descriptionSource;
  const aniRating = validRating(media?.averageScore ? media.averageScore / 10 : null);
  const communityRating = catalog?.communityRating ?? aniRating ?? row.communityRating;
  const ratingSource = catalog?.communityRating !== null && catalog?.communityRating !== undefined
    ? catalog.sourceName
    : aniRating !== null
      ? "AniList"
      : row.ratingSource;
  const primaryProvider = catalog?.sourceName ?? (media ? "AniList" : row.provider ?? "MyAnimeList");
  const primaryProviderId = catalog ? String(catalog.id) : media ? String(media.id) : row.providerId ?? "";
  const primaryUrl = safeHttpUrl(catalog?.externalUrl ?? media?.siteUrl) ?? row.externalUrl;
  const imdbId = aniListImdbId(media) ?? row.imdbId;
  const providerInstallments = type === "anime"
    ? kitsuBundle?.installments.length
      ? kitsuBundle.installments
      : aniListInstallments(media)
    : [];
  const franchiseInstallments = providerInstallments.length
    ? providerInstallments
    : parseMediaInstallments(row.franchiseInstallments);
  const countedSeasons = franchiseInstallments.filter((installment) => installment.kind === "season").length;
  const seasonCount = type === "anime"
    ? providerInstallments.length
      ? countedSeasons
      : (media ? countConnectedSeasons(media) : null) ?? row.seasonCount
    : row.seasonCount;
  const releasedSeasonCount = type === "anime"
    ? franchiseInstallments.length
      ? releasedInstallmentCount(franchiseInstallments, "season")
      : row.releasedSeasonCount
    : row.releasedSeasonCount;
  const releasedMovieCount = releasedInstallmentCount(franchiseInstallments, "movie");
  const completion = inferCompletedScope({
    type: row.type as "anime" | "manga",
    status: row.status,
    notes: row.notes,
    completedSeasons: row.completedSeasons,
    completedMovies: row.completedMovies,
    releasedSeasonCount,
    releasedMovieCount,
  });
  const sources = compactSources([
    media ? { name: "AniList", url: media.siteUrl ?? null, role: "schedule" } : null,
    kitsuBundle?.installments.length
      ? { name: "Kitsu", url: kitsu?.externalUrl ?? null, role: "schedule" }
      : null,
    !catalog?.description && aniDescription
      ? { name: "AniList", url: media?.siteUrl ?? null, role: "description" }
      : null,
    catalog ? { name: catalog.sourceName, url: catalog.externalUrl, role: "catalog" } : null,
    catalog?.description ? { name: catalog.sourceName, url: catalog.externalUrl, role: "description" } : null,
    catalog?.communityRating !== null && catalog?.communityRating !== undefined
      ? { name: catalog.sourceName, url: catalog.externalUrl, role: "rating" }
      : null,
    (catalog?.communityRating === null || catalog?.communityRating === undefined) && aniRating !== null
      ? { name: "AniList", url: media?.siteUrl ?? null, role: "rating" }
      : null,
  ]);

  return {
    alternateTitle: catalog?.alternateTitle
      ?? (media ? alternateAniListTitle(media, row.title) : null)
      ?? row.alternateTitle,
    overview,
    posterUrl: safeHttpUrl(catalog?.posterUrl ?? media?.coverImage?.extraLarge ?? media?.coverImage?.large) ?? row.posterUrl,
    backdropUrl: safeHttpUrl(media?.bannerImage ?? catalog?.backdropUrl) ?? row.backdropUrl,
    releaseDate: catalog?.releaseDate ?? dateFromParts(media?.startDate) ?? row.releaseDate,
    totalUnits,
    genres: JSON.stringify(mergeStringArrays(
      parseStringArray(row.genres),
      [...(media?.genres ?? []), ...(catalog?.genres ?? [])],
    )),
    provider: primaryProvider,
    providerId: primaryProviderId,
    externalUrl: primaryUrl,
    descriptionSource,
    communityRating,
    ratingSource,
    ratingVotes: catalog?.ratingVotes ?? row.ratingVotes,
    imdbId,
    malId: mal ? String(mal.id) : media?.idMal ? String(media.idMal) : row.malId,
    anilistId: media ? String(media.id) : row.anilistId,
    metadataSources: JSON.stringify(sources),
    seasonCount,
    releasedSeasonCount,
    completedSeasons: completion.completedSeasons,
    completedMovies: completion.completedMovies,
    franchiseInstallments: JSON.stringify(franchiseInstallments),
    availableUnits,
    airingStatus,
    nextUnit,
    nextAiringLabel,
    nextAiringAt,
    scheduleAlert: type === "anime"
      ? scheduleAlert(row, airingStatus, nextAiringLabel, nextAiringAt)
      : null,
    metadataUpdatedAt: new Date().toISOString(),
  };
}

async function findAniListMedia(row: MediaItemRow, type: "anime" | "manga") {
  const relationFields = type === "anime" ? nestedAniListRelations(1) : "";
  const mediaFields = `
    id
    idMal
    type
    format
    title { english romaji native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    genres
    status
    startDate { year month day }
    episodes
    chapters
    averageScore
    siteUrl
    nextAiringEpisode { airingAt episode }
    externalLinks { site url }
    ${relationFields}
  `;
  let candidates: AniMedia[] = [];
  const knownAniListId = row.anilistId
    ?? (row.provider === "AniList" ? row.providerId : null);
  const providerId = /^\d+$/.test(knownAniListId ?? "")
    ? Number(knownAniListId)
    : null;
  const graphType = type.toUpperCase();
  if (providerId) {
    const data = await aniListRequest<{ Media?: AniMedia | null }>(`
      query ($id: Int!, $type: MediaType!) { Media(id: $id, type: $type) { ${mediaFields} } }
    `, { id: providerId, type: graphType });
    if (data.Media) candidates = [data.Media];
  } else {
    const data = await aniListRequest<{ Page?: { media?: AniMedia[] | null } | null }>(`
      query ($search: String!, $type: MediaType!) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: $type, sort: SEARCH_MATCH) { ${mediaFields} }
        }
      }
    `, { search: row.title, type: graphType });
    candidates = data.Page?.media ?? [];
  }
  const media = bestAniListMatch(candidates, row.title);
  if (!media) throw new MetadataProviderError(notFoundFailure("anilist"));
  return media;
}

async function syncTvMaze(row: MediaItemRow): Promise<MetadataUpdate> {
  let showId = row.provider === "TVmaze" && /^\d+$/.test(row.providerId ?? "")
    ? Number(row.providerId)
    : null;
  if (!showId) {
    const search = await fetchJson<Array<{ show: TvMazeShow }>>(
      "tvmaze",
      `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(row.title)}`,
    );
    const exact = search.find(({ show }) => normalizeTitle(show.name) === normalizeTitle(row.title));
    showId = (exact ?? search[0])?.show.id ?? null;
  }
  if (!showId) throw new Error("No TVmaze match was found.");

  const [show, seasons] = await Promise.all([
    fetchJson<TvMazeShow>("tvmaze", `https://api.tvmaze.com/shows/${showId}?embed=episodes`),
    fetchJson<TvMazeSeason[]>("tvmaze", `https://api.tvmaze.com/shows/${showId}/seasons`),
  ]);
  const episodes = show._embedded?.episodes ?? [];
  const now = Date.now();
  const sorted = [...episodes].sort((a, b) => episodeTime(a) - episodeTime(b));
  const available = sorted.filter((episode) => episodeTime(episode) <= now).length;
  const next = sorted.find((episode) => episodeTime(episode) > now) ?? null;
  const nextAiringAt = next?.airstamp ? new Date(next.airstamp).toISOString() : null;
  const nextAiringLabel = next ? `S${next.season ?? "?"} E${next.number ?? "?"}` : null;
  const airingStatus = tvMazeStatus(show.status);
  const imdbId = validImdbId(show.externals?.imdb) ?? row.imdbId;
  const showUrl = safeHttpUrl(show.url) ?? row.externalUrl;
  const franchiseInstallments = seasons
    .filter((season) => (season.number ?? 0) > 0)
    .map(tvMazeSeasonInstallment);
  const releasedSeasonCount = releasedInstallmentCount(franchiseInstallments, "season");
  const completion = inferCompletedScope({
    type: "tv",
    status: row.status,
    notes: row.notes,
    completedSeasons: row.completedSeasons,
    completedMovies: row.completedMovies,
    releasedSeasonCount,
    releasedMovieCount: 0,
  });
  const sources = compactSources([
    { name: "TVmaze", url: showUrl, role: "catalog" },
    show.summary ? { name: "TVmaze", url: showUrl, role: "description" } : null,
    show.rating?.average !== null && show.rating?.average !== undefined
      ? { name: "TVmaze", url: showUrl, role: "rating" }
      : null,
    imdbId ? { name: "IMDb", url: imdbTitleUrl(imdbId), role: "identifier" } : null,
  ]);

  return {
    alternateTitle: row.alternateTitle,
    overview: stripMarkup(show.summary) ?? row.overview,
    posterUrl: safeHttpUrl(show.image?.original ?? show.image?.medium) ?? row.posterUrl,
    backdropUrl: row.backdropUrl,
    releaseDate: show.premiered ?? row.releaseDate,
    totalUnits: row.metadataUpdatedAt
      ? episodes.length || row.totalUnits
      : row.totalUnits ?? (episodes.length || null),
    genres: JSON.stringify(mergeStringArrays(parseStringArray(row.genres), show.genres ?? [])),
    provider: "TVmaze",
    providerId: String(show.id),
    externalUrl: showUrl,
    descriptionSource: show.summary ? "TVmaze" : row.descriptionSource,
    communityRating: validRating(show.rating?.average) ?? row.communityRating,
    ratingSource: validRating(show.rating?.average) !== null ? "TVmaze" : row.ratingSource,
    ratingVotes: row.ratingVotes,
    imdbId,
    malId: row.malId,
    anilistId: row.anilistId,
    metadataSources: JSON.stringify(sources),
    seasonCount: franchiseInstallments.length || row.seasonCount,
    releasedSeasonCount: franchiseInstallments.length ? releasedSeasonCount : row.releasedSeasonCount,
    completedSeasons: completion.completedSeasons,
    completedMovies: completion.completedMovies,
    franchiseInstallments: JSON.stringify(franchiseInstallments),
    availableUnits: episodes.length ? available : row.availableUnits,
    airingStatus,
    nextUnit: next?.number ?? null,
    nextAiringLabel,
    nextAiringAt,
    scheduleAlert: scheduleAlert(row, airingStatus, nextAiringLabel, nextAiringAt),
    metadataUpdatedAt: new Date().toISOString(),
  };
}

async function syncWikipedia(row: MediaItemRow): Promise<MetadataUpdate> {
  const page = await findWikipediaPage(row);
  if (!page) throw new Error("No Wikipedia match was found.");
  const wikidata = page.pageprops?.wikibase_item
    ? await getWikidataClaims(page.pageprops.wikibase_item).catch(() => null)
    : null;
  const imdbId = validImdbId(wikidata?.imdbId) ?? row.imdbId;
  const releaseDate = wikidata?.releaseDate ?? row.releaseDate;
  const pageUrl = safeHttpUrl(page.fullurl) ?? `https://en.wikipedia.org/?curid=${page.pageid}`;
  const sources = compactSources([
    { name: "Wikipedia", url: pageUrl, role: "catalog" },
    page.extract ? { name: "Wikipedia", url: pageUrl, role: "description" } : null,
    imdbId ? { name: "IMDb", url: imdbTitleUrl(imdbId), role: "identifier" } : null,
  ]);

  return {
    alternateTitle: row.alternateTitle ?? page.title,
    overview: stripMarkup(page.extract) ?? row.overview,
    posterUrl: safeHttpUrl(page.original?.source ?? page.thumbnail?.source) ?? row.posterUrl,
    backdropUrl: row.backdropUrl,
    releaseDate,
    totalUnits: row.totalUnits ?? (row.type === "game" ? 100 : null),
    genres: row.genres,
    provider: "Wikipedia",
    providerId: String(page.pageid),
    externalUrl: pageUrl,
    descriptionSource: page.extract ? "Wikipedia" : row.descriptionSource,
    communityRating: row.communityRating,
    ratingSource: row.ratingSource,
    ratingVotes: row.ratingVotes,
    imdbId,
    malId: row.malId,
    anilistId: row.anilistId,
    metadataSources: JSON.stringify(sources),
    seasonCount: row.seasonCount,
    releasedSeasonCount: row.releasedSeasonCount,
    completedSeasons: row.completedSeasons,
    completedMovies: row.completedMovies,
    franchiseInstallments: row.franchiseInstallments,
    availableUnits: row.availableUnits,
    airingStatus: row.airingStatus as AiringStatus | null,
    nextUnit: row.nextUnit,
    nextAiringLabel: row.nextAiringLabel,
    nextAiringAt: row.nextAiringAt,
    scheduleAlert: row.scheduleAlert,
    metadataUpdatedAt: new Date().toISOString(),
  };
}

async function findWikipediaPage(row: MediaItemRow) {
  const params = new URLSearchParams({
    action: "query",
    prop: "pageimages|extracts|info|pageprops",
    piprop: "thumbnail|original",
    pithumbsize: "700",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*",
  });
  if (row.provider === "Wikipedia" && /^\d+$/.test(row.providerId ?? "")) {
    params.set("pageids", row.providerId ?? "");
  } else {
    params.set("generator", "search");
    params.set("gsrsearch", `${row.title} ${row.type === "movie" ? "film" : "video game"}`);
    params.set("gsrlimit", "8");
  }
  const data = await fetchJson<{ query?: { pages?: Record<string, WikipediaPage> } }>(
    "wikipedia",
    `https://en.wikipedia.org/w/api.php?${params.toString()}`,
    { headers: { "user-agent": "MediaTracker/1.0 (personal media library)" } },
  );
  const pages = Object.values(data.query?.pages ?? {});
  const target = normalizeTitle(row.title);
  return pages.find((page) => normalizeTitle(cleanWikipediaTitle(page.title)) === target) ?? pages[0] ?? null;
}

async function getWikidataClaims(id: string) {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    props: "claims",
    format: "json",
    origin: "*",
  });
  const data = await fetchJson<{ entities?: Record<string, { claims?: Record<string, Array<{
    mainsnak?: { datavalue?: { value?: unknown } };
  }>> }> }>("wikidata", `https://www.wikidata.org/w/api.php?${params.toString()}`);
  const claims = data.entities?.[id]?.claims;
  const imdbValue = claims?.P345?.[0]?.mainsnak?.datavalue?.value;
  const dateValue = claims?.P577?.[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
  const releaseDate = typeof dateValue?.time === "string"
    ? dateValue.time.replace(/^\+/, "").slice(0, 10)
    : null;
  return {
    imdbId: typeof imdbValue === "string" ? imdbValue : null,
    releaseDate: /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(releaseDate ?? "") ? releaseDate : null,
  };
}

function nestedAniListRelations(depth: number): string {
  if (depth <= 0) return "";
  return `relations {
    edges {
      relationType
      node {
        id
        type
        format
        title { english romaji native }
        status
        startDate { year month day }
        siteUrl
        ${nestedAniListRelations(depth - 1)}
      }
    }
  }`;
}

function aniListInstallments(root: AniMedia | null): MediaInstallment[] {
  if (!root) return [];
  const nodes = new Map<number, AniRelationNode>([[root.id, root]]);
  for (const edge of root.relations?.edges ?? []) {
    if (!["PREQUEL", "SEQUEL"].includes(edge.relationType ?? "") || !edge.node || edge.node.type !== "ANIME") continue;
    nodes.set(edge.node.id, edge.node);
  }
  const installments = [...nodes.values()].flatMap((node) => {
    const kind = node.format === "MOVIE" ? "movie" : SHOW_FORMATS.has(node.format ?? "") ? "season" : null;
    if (!kind) return [];
    return [{
      providerId: String(node.id),
      title: aniListNodeTitle(node),
      kind,
      seasonNumber: null,
      status: aniListStatus(node.status),
      releaseDate: dateFromParts(node.startDate),
      externalUrl: safeHttpUrl(node.siteUrl),
    } satisfies MediaInstallment];
  }).sort((left, right) => (left.releaseDate ?? "9999").localeCompare(right.releaseDate ?? "9999"));
  let season = 0;
  return installments.map((installment) => installment.kind === "season"
    ? { ...installment, seasonNumber: ++season }
    : installment);
}

function aniListNodeTitle(node: AniRelationNode) {
  return node.title?.english ?? node.title?.romaji ?? node.title?.native ?? `Anime ${node.id}`;
}

function countConnectedSeasons(root: AniMedia) {
  if (!SHOW_FORMATS.has(root.format ?? "")) return null;
  const seasonIds = new Set<number>([root.id]);
  const walked = new Set<number>();
  const visit = (node: AniRelationNode) => {
    if (walked.has(node.id)) return;
    walked.add(node.id);
    for (const edge of node.relations?.edges ?? []) {
      const related = edge.node;
      if (!related || !["PREQUEL", "SEQUEL"].includes(edge.relationType ?? "")) continue;
      if (related.type !== "ANIME" || !SHOW_FORMATS.has(related.format ?? "")) continue;
      seasonIds.add(related.id);
      visit(related);
    }
  };
  visit(root);
  return seasonIds.size;
}

function bestAniListMatch(candidates: AniMedia[], title: string) {
  const target = normalizeTitle(title);
  return candidates.find((candidate) => [
    candidate.title.english,
    candidate.title.romaji,
    candidate.title.native,
  ].some((value) => normalizeTitle(value ?? "") === target)) ?? candidates[0] ?? null;
}

function alternateAniListTitle(media: AniMedia, currentTitle: string) {
  const options = [media.title.english, media.title.romaji, media.title.native].filter(
    (value): value is string => Boolean(value),
  );
  return options.find((value) => normalizeTitle(value) !== normalizeTitle(currentTitle)) ?? null;
}

function scheduleAlert(
  previous: MediaItemRow,
  status: AiringStatus,
  nextLabel: string | null,
  nextAt: string | null,
) {
  if (status === "hiatus") return "The metadata provider currently marks this title as on hiatus.";
  if (status === "cancelled") return "The metadata provider currently marks this title as cancelled.";
  if (status === "releasing" && !nextAt) return "Currently airing, but no next episode time is listed yet.";
  if (previous.nextAiringAt && previous.nextAiringLabel === nextLabel && nextAt) {
    const delayMs = Date.parse(nextAt) - Date.parse(previous.nextAiringAt);
    if (Number.isFinite(delayMs) && delayMs > 6 * 60 * 60 * 1_000) {
      const days = Math.max(1, Math.round(delayMs / 86_400_000));
      return `${nextLabel} moved back by about ${days} ${days === 1 ? "day" : "days"} since the last sync.`;
    }
  }
  return null;
}

function aniListStatus(value: string | null | undefined): AiringStatus {
  if (value === "RELEASING") return "releasing";
  if (value === "FINISHED") return "finished";
  if (value === "NOT_YET_RELEASED") return "not_yet_released";
  if (value === "CANCELLED") return "cancelled";
  if (value === "HIATUS") return "hiatus";
  return "unknown";
}

function tvMazeStatus(value: string | null | undefined): AiringStatus {
  if (value === "Running") return "releasing";
  if (value === "Ended") return "finished";
  if (value === "In Development") return "not_yet_released";
  return "unknown";
}

async function aniListRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const data = await fetchJson<{ data?: T; errors?: Array<{ message?: string }> }>("anilist", ANILIST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "MediaTracker/1.0 (private personal library)",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!data.data) {
    const failure = await recordInvalidProviderResponse("anilist");
    throw new MetadataProviderError(failure, data.errors?.[0]?.message || "AniList returned no data.");
  }
  return data.data;
}

async function fetchJson<T>(provider: MetadataProviderId, url: string, init?: RequestInit): Promise<T> {
  return fetchProviderJson<T>(provider, url, init, { attempts: 2, timeoutMs: 10_000 });
}

function aniListImdbId(media: AniMedia | null) {
  for (const link of media?.externalLinks ?? []) {
    if (link.site?.toLowerCase() !== "imdb" && !link.url?.includes("imdb.com/title/")) continue;
    const match = link.url?.match(/\/title\/(tt\d{5,12})/i);
    if (match) return validImdbId(match[1]);
  }
  return null;
}

function stripMarkup(value: string | null | undefined) {
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

function dateFromParts(parts: AniMedia["startDate"] | undefined) {
  if (!parts?.year) return null;
  return `${parts.year}-${String(parts.month ?? 1).padStart(2, "0")}-${String(parts.day ?? 1).padStart(2, "0")}`;
}

function unixToIso(value: number | null) {
  if (!value) return null;
  return new Date(value * 1_000).toISOString();
}

function episodeTime(episode: TvMazeEpisode) {
  const value = episode.airstamp ?? (episode.airdate ? `${episode.airdate}T23:59:59Z` : null);
  const time = value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function tvMazeSeasonInstallment(season: TvMazeSeason): MediaInstallment {
  const releaseDate = validDate(season.premiereDate);
  const endDate = validDate(season.endDate);
  const now = Date.now();
  const startsAt = releaseDate ? Date.parse(`${releaseDate}T00:00:00Z`) : Number.POSITIVE_INFINITY;
  const endsAt = endDate ? Date.parse(`${endDate}T23:59:59Z`) : Number.POSITIVE_INFINITY;
  const status: AiringStatus = !Number.isFinite(startsAt) || startsAt > now
    ? "not_yet_released"
    : Number.isFinite(endsAt) && endsAt < now
      ? "finished"
      : "releasing";
  return {
    providerId: String(season.id),
    title: season.name?.trim() || `Season ${season.number ?? "?"}`,
    kind: "season",
    seasonNumber: season.number ?? null,
    status,
    releaseDate,
    externalUrl: safeHttpUrl(season.url),
  };
}

function normalizeTitle(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanWikipediaTitle(value: string) {
  return value.replace(/\s*\((film|video game|\d{4} film)\)$/i, "");
}

function validDate(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseMetadataSources(value: string | null | undefined): MetadataSource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MetadataSource => Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as MetadataSource).name === "string"
      && typeof (entry as MetadataSource).role === "string");
  } catch {
    return [];
  }
}

function mergeStringArrays(first: string[], second: string[]) {
  return [...new Set([...first, ...second].filter(Boolean))];
}

function validRating(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function validImdbId(value: string | null | undefined) {
  return typeof value === "string" && /^tt\d{5,12}$/.test(value) ? value : null;
}

function imdbTitleUrl(id: string) {
  return `https://www.imdb.com/title/${id}/`;
}

function compactSources(values: Array<MetadataSource | null>): MetadataSource[] {
  const seen = new Set<string>();
  return values.filter((value): value is MetadataSource => Boolean(value)).map((value) => ({
    ...value,
    url: safeHttpUrl(value.url),
  })).filter((value) => {
    const key = `${value.name}:${value.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
