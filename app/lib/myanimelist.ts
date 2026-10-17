import type { AiringStatus, MediaType } from "./media.ts";
import {
  fetchProviderJson,
  MetadataProviderAggregateError,
  providerFailuresFrom,
  type MetadataProviderFailure,
} from "./metadata-provider.ts";

export type MyAnimeListMetadata = {
  id: number;
  title: string;
  alternateTitle: string | null;
  description: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  totalUnits: number | null;
  genres: string[];
  status: AiringStatus;
  communityRating: number | null;
  ratingVotes: number | null;
  externalUrl: string;
  sourceName: "MyAnimeList" | "MyAnimeList via Jikan";
  mediaLabel: string | null;
};

type MalNode = {
  id: number;
  title: string;
  main_picture?: { medium?: string | null; large?: string | null } | null;
  alternative_titles?: { synonyms?: string[]; en?: string | null; ja?: string | null } | null;
  start_date?: string | null;
  synopsis?: string | null;
  mean?: number | null;
  num_scoring_users?: number | null;
  media_type?: string | null;
  status?: string | null;
  genres?: Array<{ id: number; name: string }> | null;
  num_episodes?: number | null;
  num_chapters?: number | null;
  pictures?: Array<{ medium?: string | null; large?: string | null }> | null;
};

type JikanEntry = {
  mal_id: number;
  url?: string | null;
  images?: { jpg?: { large_image_url?: string | null; image_url?: string | null } | null } | null;
  trailer?: { images?: { maximum_image_url?: string | null; large_image_url?: string | null } | null } | null;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  title_synonyms?: string[] | null;
  type?: string | null;
  episodes?: number | null;
  chapters?: number | null;
  status?: string | null;
  airing?: boolean | null;
  publishing?: boolean | null;
  aired?: { from?: string | null } | null;
  published?: { from?: string | null } | null;
  score?: number | null;
  scored_by?: number | null;
  synopsis?: string | null;
  background?: string | null;
  genres?: Array<{ name?: string | null }> | null;
  themes?: Array<{ name?: string | null }> | null;
  demographics?: Array<{ name?: string | null }> | null;
};

const MAL_FIELDS = [
  "id",
  "title",
  "main_picture",
  "alternative_titles",
  "start_date",
  "synopsis",
  "mean",
  "num_scoring_users",
  "media_type",
  "status",
  "genres",
  "num_episodes",
  "num_chapters",
  "pictures",
].join(",");

let jikanQueue: Promise<void> = Promise.resolve();
let lastJikanRequestAt = 0;
let jikanWindowStartedAt = 0;
let jikanWindowRequests = 0;

export async function getMyAnimeListMode(): Promise<"direct" | "jikan"> {
  return await getMyAnimeListClientId() ? "direct" : "jikan";
}

export async function searchMyAnimeList(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId?: string | null,
  limit = 8,
): Promise<MyAnimeListMetadata[]> {
  const clientId = await getMyAnimeListClientId();
  const failures: MetadataProviderFailure[] = [];
  if (clientId) {
    try {
      const direct = await searchOfficialMyAnimeList(title, type, knownId, limit, clientId);
      if (direct.length) return direct;
    } catch (error) {
      failures.push(...providerFailuresFrom(error, "myanimelist"));
      console.warn("Direct MyAnimeList request failed; trying the public Jikan bridge.", {
        failures: failures.map(({ provider, code, status }) => ({ provider, code, status })),
      });
    }
  }
  try {
    return await searchJikan(title, type, knownId, limit);
  } catch (error) {
    failures.push(...providerFailuresFrom(error, "jikan"));
    throw new MetadataProviderAggregateError(failures);
  }
}

export async function bestMyAnimeListMatch(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId?: string | null,
): Promise<MyAnimeListMetadata | null> {
  const candidates = await searchMyAnimeList(title, type, knownId, 8);
  const normalized = normalizeTitle(title);
  return candidates.find((candidate) => [candidate.title, candidate.alternateTitle]
    .some((value) => normalizeTitle(value ?? "") === normalized)) ?? candidates[0] ?? null;
}

async function searchOfficialMyAnimeList(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId: string | null | undefined,
  limit: number,
  clientId: string,
) {
  const endpoint = knownId && /^\d+$/.test(knownId)
    ? `https://api.myanimelist.net/v2/${type}/${knownId}?fields=${encodeURIComponent(MAL_FIELDS)}`
    : `https://api.myanimelist.net/v2/${type}?q=${encodeURIComponent(title)}&limit=${Math.min(10, limit)}&fields=${encodeURIComponent(MAL_FIELDS)}`;
  const data = await fetchProviderJson<MalNode | { data?: Array<{ node: MalNode }> }>("myanimelist", endpoint, {
    headers: { "X-MAL-CLIENT-ID": clientId, accept: "application/json" },
  }, { attempts: 2, timeoutMs: 10_000 });
  const nodes = "data" in data
    ? data.data?.map((entry) => entry.node) ?? []
    : [data as MalNode];
  return nodes.map((node) => fromMalNode(node, type));
}

async function searchJikan(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId: string | null | undefined,
  limit: number,
) {
  const endpoint = knownId && /^\d+$/.test(knownId)
    ? `https://api.jikan.moe/v4/${type}/${knownId}`
    : `https://api.jikan.moe/v4/${type}?q=${encodeURIComponent(title)}&limit=${Math.min(10, limit)}&sfw=true`;
  const data = await jikanFetch<{ data?: JikanEntry | JikanEntry[] }>(endpoint);
  const entries = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
  return entries.map((entry) => fromJikanEntry(entry, type));
}

function fromMalNode(node: MalNode, type: Extract<MediaType, "anime" | "manga">): MyAnimeListMetadata {
  const alternateTitle = firstDifferentTitle(node.title, [
    node.alternative_titles?.en,
    ...(node.alternative_titles?.synonyms ?? []),
    node.alternative_titles?.ja,
  ]);
  return {
    id: node.id,
    title: node.alternative_titles?.en || node.title,
    alternateTitle,
    description: cleanDescription(node.synopsis),
    posterUrl: safeHttpUrl(node.main_picture?.large ?? node.main_picture?.medium),
    backdropUrl: safeHttpUrl(node.pictures?.at(1)?.large ?? node.pictures?.at(1)?.medium),
    releaseDate: node.start_date ?? null,
    totalUnits: type === "anime" ? node.num_episodes ?? null : node.num_chapters ?? null,
    genres: node.genres?.map((genre) => genre.name).filter(Boolean) ?? [],
    status: malStatus(node.status),
    communityRating: validRating(node.mean),
    ratingVotes: validCount(node.num_scoring_users),
    externalUrl: `https://myanimelist.net/${type}/${node.id}`,
    sourceName: "MyAnimeList",
    mediaLabel: node.media_type?.replaceAll("_", " ") ?? null,
  };
}

function fromJikanEntry(entry: JikanEntry, type: Extract<MediaType, "anime" | "manga">): MyAnimeListMetadata {
  const title = entry.title_english || entry.title || entry.title_japanese || "Untitled";
  const alternateTitle = firstDifferentTitle(title, [
    entry.title,
    ...(entry.title_synonyms ?? []),
    entry.title_japanese,
  ]);
  return {
    id: entry.mal_id,
    title,
    alternateTitle,
    description: cleanDescription(entry.synopsis),
    posterUrl: safeHttpUrl(entry.images?.jpg?.large_image_url ?? entry.images?.jpg?.image_url),
    backdropUrl: safeHttpUrl(entry.trailer?.images?.maximum_image_url ?? entry.trailer?.images?.large_image_url),
    releaseDate: (type === "anime" ? entry.aired?.from : entry.published?.from)?.slice(0, 10) ?? null,
    totalUnits: type === "anime" ? entry.episodes ?? null : entry.chapters ?? null,
    genres: uniqueStrings([
      ...(entry.genres ?? []).map((genre) => genre.name),
      ...(entry.themes ?? []).map((theme) => theme.name),
      ...(entry.demographics ?? []).map((demographic) => demographic.name),
    ]),
    status: jikanStatus(entry, type),
    communityRating: validRating(entry.score),
    ratingVotes: validCount(entry.scored_by),
    externalUrl: safeHttpUrl(entry.url) || `https://myanimelist.net/${type}/${entry.mal_id}`,
    sourceName: "MyAnimeList via Jikan",
    mediaLabel: entry.type ?? null,
  };
}

export async function getMyAnimeListClientId() {
  try {
    const { env } = await import("cloudflare:workers");
    const value = (env as unknown as Record<string, unknown>).MYANIMELIST_CLIENT_ID;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return process.env.MYANIMELIST_CLIENT_ID?.trim() || null;
  }
}

async function jikanFetch<T>(url: string): Promise<T> {
  let resolveValue!: (value: T | PromiseLike<T>) => void;
  let rejectValue!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  jikanQueue = jikanQueue.then(async () => {
    let now = Date.now();
    if (!jikanWindowStartedAt || now - jikanWindowStartedAt >= 60_000) {
      jikanWindowStartedAt = now;
      jikanWindowRequests = 0;
    }
    if (jikanWindowRequests >= 55) {
      const waitForNextWindow = Math.max(500, 60_250 - (now - jikanWindowStartedAt));
      await new Promise((resolve) => setTimeout(resolve, waitForNextWindow));
      now = Date.now();
      jikanWindowStartedAt = now;
      jikanWindowRequests = 0;
    }
    const spacing = Math.max(0, 360 - (now - lastJikanRequestAt));
    if (spacing) await new Promise((resolve) => setTimeout(resolve, spacing));
    lastJikanRequestAt = Date.now();
    jikanWindowRequests += 1;
    try {
      resolveValue(await fetchProviderJson<T>("jikan", url, undefined, {
        attempts: 2,
        timeoutMs: 10_000,
      }));
    } catch (error) {
      rejectValue(error);
    }
  }).catch(() => undefined);
  return result;
}

function cleanDescription(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 1_500) : null;
}

function firstDifferentTitle(current: string, options: Array<string | null | undefined>) {
  return options.find((value): value is string => Boolean(value)
    && normalizeTitle(value ?? "") !== normalizeTitle(current)) ?? null;
}

function normalizeTitle(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function validRating(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
}

function validCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

function malStatus(value: string | null | undefined): AiringStatus {
  if (["currently_airing", "currently_publishing"].includes(value ?? "")) return "releasing";
  if (["finished_airing", "finished"].includes(value ?? "")) return "finished";
  if (["not_yet_aired", "not_yet_published"].includes(value ?? "")) return "not_yet_released";
  if (value === "on_hiatus") return "hiatus";
  if (value === "discontinued") return "cancelled";
  return "unknown";
}

function jikanStatus(entry: JikanEntry, type: Extract<MediaType, "anime" | "manga">): AiringStatus {
  if (type === "anime" && entry.airing) return "releasing";
  if (type === "manga" && entry.publishing) return "releasing";
  const status = entry.status?.toLowerCase() ?? "";
  if (status.includes("finished")) return "finished";
  if (status.includes("not yet")) return "not_yet_released";
  if (status.includes("hiatus")) return "hiatus";
  if (status.includes("discontinued")) return "cancelled";
  return "unknown";
}
