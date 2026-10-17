import type { AiringStatus, MediaInstallment, MediaType } from "./media.ts";
import { fetchProviderJson } from "./metadata-provider.ts";

export type KitsuMetadata = {
  id: string;
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
  sourceName: "Kitsu";
  mediaLabel: string | null;
};

type KitsuResource = {
  id: string;
  type?: string | null;
  attributes?: {
    slug?: string | null;
    synopsis?: string | null;
    description?: string | null;
    canonicalTitle?: string | null;
    titles?: Record<string, string | null | undefined> | null;
    abbreviatedTitles?: string[] | null;
    averageRating?: string | null;
    userCount?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    status?: string | null;
    subtype?: string | null;
    episodeCount?: number | null;
    chapterCount?: number | null;
    posterImage?: { original?: string | null; large?: string | null } | null;
    coverImage?: { original?: string | null; large?: string | null } | null;
  } | null;
  relationships?: {
    mediaRelationships?: { data?: Array<{ id?: string | null; type?: string | null }> | null } | null;
  } | null;
};

type KitsuRelationshipResource = {
  id: string;
  type?: string | null;
  attributes?: { role?: string | null } | null;
  relationships?: {
    destination?: { data?: { id?: string | null; type?: string | null } | null } | null;
  } | null;
};

type KitsuDocument = {
  data?: KitsuResource | KitsuResource[];
  included?: Array<KitsuResource | KitsuRelationshipResource> | null;
};

export async function searchKitsu(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId?: string | null,
  limit = 8,
) {
  const endpoint = knownId && /^\d+$/.test(knownId)
    ? `https://kitsu.io/api/edge/${type}/${knownId}`
    : kitsuSearchUrl(title, type, limit);
  const data = await fetchProviderJson<{ data?: KitsuResource | KitsuResource[] }>(
    "kitsu",
    endpoint,
    { headers: { accept: "application/vnd.api+json" } },
    { attempts: 2, timeoutMs: 10_000 },
  );
  const resources = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
  return resources.map((resource) => fromKitsuResource(resource, type));
}

export async function bestKitsuMatch(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId?: string | null,
) {
  const candidates = await searchKitsu(title, type, knownId, 8);
  const target = normalizeTitle(title);
  return candidates.find((candidate) => [candidate.title, candidate.alternateTitle]
    .some((value) => normalizeTitle(value ?? "") === target)) ?? candidates[0] ?? null;
}

export async function bestKitsuBundle(
  title: string,
  type: Extract<MediaType, "anime" | "manga">,
  knownId?: string | null,
): Promise<{ metadata: KitsuMetadata; installments: MediaInstallment[] } | null> {
  if (type === "manga") {
    const metadata = await bestKitsuMatch(title, type, knownId);
    return metadata ? { metadata, installments: [] } : null;
  }

  const data = await fetchProviderJson<KitsuDocument>(
    "kitsu",
    kitsuFranchiseUrl(title),
    { headers: { accept: "application/vnd.api+json" } },
    { attempts: 2, timeoutMs: 10_000 },
  );
  const roots = Array.isArray(data.data) ? data.data : data.data ? [data.data] : [];
  const selected = selectKitsuResource(roots, title, knownId);
  if (!selected) return null;

  const resources = new Map<string, KitsuResource>();
  for (const resource of [...roots, ...(data.included ?? [])]) {
    if (resource.type === "mediaRelationships") continue;
    if (!resource.id || (resource.type && resource.type !== "anime")) continue;
    resources.set(resource.id, resource as KitsuResource);
  }
  const relationships = new Map<string, KitsuRelationshipResource>();
  for (const resource of data.included ?? []) {
    if (resource.type === "mediaRelationships") relationships.set(resource.id, resource as KitsuRelationshipResource);
  }

  const graph = new Map<string, Set<string>>();
  for (const resource of resources.values()) {
    for (const reference of resource.relationships?.mediaRelationships?.data ?? []) {
      if (!reference.id) continue;
      const relationship = relationships.get(reference.id);
      if (!relationship || !["prequel", "sequel"].includes(relationship.attributes?.role ?? "")) continue;
      const destination = relationship.relationships?.destination?.data;
      if (!destination?.id || destination.type !== "anime") continue;
      connect(graph, resource.id, destination.id);
    }
  }

  const connected = walkGraph(graph, selected.id);
  const franchiseKey = normalizeFranchiseTitle(fromKitsuResource(selected, "anime").title);
  for (const root of roots) {
    if (normalizeFranchiseTitle(fromKitsuResource(root, "anime").title) === franchiseKey) connected.add(root.id);
  }
  connected.add(selected.id);

  const rawInstallments = [...connected]
    .map((id) => resources.get(id))
    .filter((resource): resource is KitsuResource => Boolean(resource))
    .map(toInstallment)
    .filter((installment): installment is MediaInstallment => Boolean(installment));
  const installments = numberAndSortSeasons(dedupeInstallments(rawInstallments));
  return { metadata: fromKitsuResource(selected, "anime"), installments };
}

function fromKitsuResource(
  resource: KitsuResource,
  type: Extract<MediaType, "anime" | "manga">,
): KitsuMetadata {
  const attributes = resource.attributes ?? {};
  const titleOptions = [
    attributes.titles?.en,
    attributes.titles?.en_us,
    attributes.canonicalTitle,
    attributes.titles?.en_jp,
    ...(attributes.abbreviatedTitles ?? []),
    attributes.titles?.ja_jp,
  ].filter((value): value is string => Boolean(value));
  const title = titleOptions[0] ?? "Untitled";
  const alternateTitle = titleOptions.find((value) => normalizeTitle(value) !== normalizeTitle(title)) ?? null;
  const averageRating = Number(attributes.averageRating);
  const slug = attributes.slug || resource.id;
  return {
    id: resource.id,
    title,
    alternateTitle,
    description: cleanDescription(attributes.synopsis ?? attributes.description),
    posterUrl: safeHttpUrl(attributes.posterImage?.original ?? attributes.posterImage?.large),
    backdropUrl: safeHttpUrl(attributes.coverImage?.original ?? attributes.coverImage?.large),
    releaseDate: validDate(attributes.startDate),
    totalUnits: type === "anime"
      ? validCount(attributes.episodeCount)
      : validCount(attributes.chapterCount),
    genres: [],
    status: kitsuStatus(attributes.status),
    communityRating: Number.isFinite(averageRating) && averageRating >= 0 && averageRating <= 100
      ? averageRating / 10
      : null,
    ratingVotes: validCount(attributes.userCount),
    externalUrl: `https://kitsu.app/${type}/${encodeURIComponent(slug)}`,
    sourceName: "Kitsu",
    mediaLabel: attributes.subtype ?? null,
  };
}

function kitsuSearchUrl(title: string, type: "anime" | "manga", limit: number) {
  const params = new URLSearchParams({
    "filter[text]": title,
    "page[limit]": String(Math.max(1, Math.min(10, limit))),
  });
  return `https://kitsu.io/api/edge/${type}?${params.toString()}`;
}

function kitsuFranchiseUrl(title: string) {
  const params = new URLSearchParams({
    "filter[text]": title,
    include: "mediaRelationships.destination",
    "page[limit]": "10",
  });
  return `https://kitsu.io/api/edge/anime?${params.toString()}`;
}

function selectKitsuResource(resources: KitsuResource[], title: string, knownId?: string | null) {
  if (knownId) {
    const known = resources.find((resource) => resource.id === knownId);
    if (known) return known;
  }
  const target = normalizeTitle(title);
  return resources.find((resource) => {
    const metadata = fromKitsuResource(resource, "anime");
    return [metadata.title, metadata.alternateTitle]
      .some((value) => normalizeTitle(value ?? "") === target);
  }) ?? resources[0] ?? null;
}

function connect(graph: Map<string, Set<string>>, left: string, right: string) {
  if (!graph.has(left)) graph.set(left, new Set());
  if (!graph.has(right)) graph.set(right, new Set());
  graph.get(left)?.add(right);
  graph.get(right)?.add(left);
}

function walkGraph(graph: Map<string, Set<string>>, root: string) {
  const visited = new Set<string>();
  const queue = [root];
  while (queue.length && visited.size < 30) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function toInstallment(resource: KitsuResource): MediaInstallment | null {
  const metadata = fromKitsuResource(resource, "anime");
  const subtype = metadata.mediaLabel?.toLowerCase().replaceAll("_", "") ?? "";
  const kind = subtype === "movie"
    ? "movie"
    : ["tv", "tvshort", "ona"].includes(subtype)
      ? "season"
      : null;
  if (!kind) return null;
  return {
    providerId: resource.id,
    title: metadata.title,
    kind,
    seasonNumber: kind === "season" ? seasonNumberFromTitle(metadata.title) : null,
    status: metadata.status,
    releaseDate: metadata.releaseDate,
    externalUrl: metadata.externalUrl,
  };
}

function seasonNumberFromTitle(title: string) {
  const match = title.match(/\b(?:season|part|cour)\s*(\d{1,2})\b/i)
    ?? title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)
    ?? title.match(/\b(\d{1,2})\s*$/);
  if (match) return Number(match[1]);
  const roman = title.match(/\b(II|III|IV|V|VI)\s*$/i)?.[1]?.toUpperCase();
  return roman ? ({ II: 2, III: 3, IV: 4, V: 5, VI: 6 } as Record<string, number>)[roman] ?? null : null;
}

function normalizeFranchiseTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+season\b/g, " ")
    .replace(/\b(?:season|part|cour)\s*\d{1,2}\b/g, " ")
    .replace(/\b(?:ii|iii|iv|v|vi|\d{1,2})\s*$/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function dedupeInstallments(installments: MediaInstallment[]) {
  return [...new Map(installments.map((installment) => [installment.providerId, installment])).values()];
}

function numberAndSortSeasons(installments: MediaInstallment[]) {
  const seasons = installments
    .filter((installment) => installment.kind === "season")
    .sort((left, right) => (left.releaseDate ?? "9999").localeCompare(right.releaseDate ?? "9999") || left.title.localeCompare(right.title));
  const numbered = new Map(seasons.map((installment, index) => [
    installment.providerId,
    installment.seasonNumber ?? index + 1,
  ]));
  return installments.map((installment) => ({
    ...installment,
    seasonNumber: installment.kind === "season" ? numbered.get(installment.providerId) ?? null : null,
  })).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "season" ? -1 : 1;
    return (left.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (right.seasonNumber ?? Number.MAX_SAFE_INTEGER)
      || (left.releaseDate ?? "9999").localeCompare(right.releaseDate ?? "9999");
  });
}

function kitsuStatus(value: string | null | undefined): AiringStatus {
  if (value === "current") return "releasing";
  if (value === "finished") return "finished";
  if (["tba", "unreleased", "upcoming"].includes(value ?? "")) return "not_yet_released";
  return "unknown";
}

function validDate(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function validCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function cleanDescription(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 1_500) : null;
}

function normalizeTitle(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
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
