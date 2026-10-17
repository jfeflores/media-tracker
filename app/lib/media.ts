export const MEDIA_TYPES = ["anime", "manga", "tv", "movie", "game"] as const;
export const MEDIA_STATUSES = [
  "watchlist",
  "in_progress",
  "on_hold",
  "finished",
  "dropped",
] as const;
export const MEDIA_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MEDIA_TIERS = ["unranked", "s", "a", "b", "c", "d", "f"] as const;
export const AIRING_STATUSES = [
  "releasing",
  "finished",
  "not_yet_released",
  "cancelled",
  "hiatus",
  "unknown",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
export type MediaPriority = (typeof MEDIA_PRIORITIES)[number];
export type MediaTier = (typeof MEDIA_TIERS)[number];
export type AiringStatus = (typeof AIRING_STATUSES)[number];

export type MetadataSource = {
  name: string;
  url: string | null;
  role: "catalog" | "schedule" | "description" | "rating" | "identifier";
};

export type MediaInstallment = {
  providerId: string;
  title: string;
  kind: "season" | "movie";
  seasonNumber: number | null;
  status: AiringStatus;
  releaseDate: string | null;
  externalUrl: string | null;
};

export type MediaItem = {
  id: string;
  title: string;
  alternateTitle: string | null;
  type: MediaType;
  status: MediaStatus;
  priority: MediaPriority;
  tier: MediaTier;
  progress: number;
  totalUnits: number | null;
  unitLabel: string;
  rating: number | null;
  review: string | null;
  notes: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  reminderDate: string | null;
  genres: string[];
  tags: string[];
  provider: string | null;
  providerId: string | null;
  externalUrl: string | null;
  descriptionSource: string | null;
  communityRating: number | null;
  ratingSource: string | null;
  ratingVotes: number | null;
  imdbId: string | null;
  malId: string | null;
  anilistId: string | null;
  metadataSources: MetadataSource[];
  seasonCount: number | null;
  releasedSeasonCount: number | null;
  completedSeasons: number | null;
  completedMovies: number | null;
  franchiseInstallments: MediaInstallment[];
  availableUnits: number | null;
  airingStatus: AiringStatus | null;
  nextUnit: number | null;
  nextAiringLabel: string | null;
  nextAiringAt: string | null;
  scheduleAlert: string | null;
  metadataUpdatedAt: string | null;
  metadataLastAttemptAt: string | null;
  metadataLastErrorCode: string | null;
  metadataLastErrorProvider: string | null;
  metadataRetryAfterAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaInput = Omit<
  MediaItem,
  | "id"
  | "seasonCount"
  | "descriptionSource"
  | "communityRating"
  | "ratingSource"
  | "ratingVotes"
  | "imdbId"
  | "malId"
  | "anilistId"
  | "metadataSources"
  | "releasedSeasonCount"
  | "franchiseInstallments"
  | "availableUnits"
  | "airingStatus"
  | "nextUnit"
  | "nextAiringLabel"
  | "nextAiringAt"
  | "scheduleAlert"
  | "metadataUpdatedAt"
  | "metadataLastAttemptAt"
  | "metadataLastErrorCode"
  | "metadataLastErrorProvider"
  | "metadataRetryAfterAt"
  | "createdAt"
  | "updatedAt"
>;

export type DiscoveryResult = {
  key: string;
  provider: string;
  providerId: string;
  type: MediaType;
  title: string;
  alternateTitle: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  totalUnits: number | null;
  unitLabel: string;
  genres: string[];
  externalUrl: string | null;
  meta: string | null;
};

export const TYPE_LABELS: Record<MediaType, string> = {
  anime: "Anime",
  manga: "Manga",
  tv: "TV Series",
  movie: "Movies",
  game: "Games",
};

export const STATUS_LABELS: Record<MediaStatus, string> = {
  watchlist: "Watchlist",
  in_progress: "In progress",
  on_hold: "On hold",
  finished: "Finished",
  dropped: "Dropped",
};

export const PRIORITY_LABELS: Record<MediaPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Next up",
};

export const TIER_LABELS: Record<MediaTier, string> = {
  unranked: "Unranked",
  s: "S Tier",
  a: "A Tier",
  b: "B Tier",
  c: "C Tier",
  d: "D Tier",
  f: "F Tier",
};

export const AIRING_STATUS_LABELS: Record<AiringStatus, string> = {
  releasing: "Currently airing",
  finished: "Finished airing",
  not_yet_released: "Not yet released",
  cancelled: "Cancelled",
  hiatus: "On hiatus",
  unknown: "Schedule unknown",
};

export function defaultUnit(type: MediaType) {
  if (type === "manga") return "chapters";
  if (type === "game") return "percent";
  if (type === "movie") return "minutes";
  return "episodes";
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseMetadataSources(value: string | null | undefined): MetadataSource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const roles = new Set<MetadataSource["role"]>(["catalog", "schedule", "description", "rating", "identifier"]);
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      if (typeof value.name !== "string" || !value.name.trim()) return [];
      const role = roles.has(value.role as MetadataSource["role"])
        ? value.role as MetadataSource["role"]
        : "catalog";
      return [{
        name: value.name.trim().slice(0, 80),
        url: typeof value.url === "string" ? value.url : null,
        role,
      }];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

export function parseMediaInstallments(value: string | null | undefined): MediaInstallment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const statuses = new Set<AiringStatus>(AIRING_STATUSES);
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const installment = entry as Record<string, unknown>;
      if (typeof installment.providerId !== "string" || typeof installment.title !== "string") return [];
      if (installment.kind !== "season" && installment.kind !== "movie") return [];
      const status = statuses.has(installment.status as AiringStatus)
        ? installment.status as AiringStatus
        : "unknown";
      return [{
        providerId: installment.providerId.slice(0, 100),
        title: installment.title.slice(0, 300),
        kind: installment.kind as MediaInstallment["kind"],
        seasonNumber: typeof installment.seasonNumber === "number" && Number.isInteger(installment.seasonNumber)
          ? Math.max(0, installment.seasonNumber)
          : null,
        status,
        releaseDate: typeof installment.releaseDate === "string" ? installment.releaseDate.slice(0, 40) : null,
        externalUrl: typeof installment.externalUrl === "string" ? installment.externalUrl : null,
      }];
    }).slice(0, 30);
  } catch {
    return [];
  }
}
