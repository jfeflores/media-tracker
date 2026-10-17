"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  Database,
  ExternalLink,
  Film,
  Folder,
  FolderPlus,
  Gamepad2,
  GripVertical,
  ImageIcon,
  LayoutGrid,
  Library,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Clock3,
  Tag,
  Trash2,
  Trophy,
  Tv,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MEDIA_PRIORITIES,
  MEDIA_STATUSES,
  MEDIA_TIERS,
  MEDIA_TYPES,
  AIRING_STATUS_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TIER_LABELS,
  TYPE_LABELS,
  defaultUnit,
  type DiscoveryResult,
  type MediaInput,
  type MediaItem,
  type MediaPriority,
  type MediaStatus,
  type MediaTier,
  type MediaType,
} from "@/app/lib/media";
import { continuationForItem, releasedInstallmentCount, type ContinuationInfo } from "@/app/lib/continuation";
import type { CollectionFilterKey, MediaCollection } from "@/app/lib/collections";
import DataExportActions from "@/app/components/data-export-actions";
import ReminderCenter from "@/app/components/reminder-center";
import { useDialogFocus } from "@/app/hooks/use-dialog-focus";

type FilterType = "all" | MediaType;
type FilterStatus = "all" | "continue" | MediaStatus;
type SortMode =
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "priority_desc"
  | "priority_asc"
  | "tier_desc"
  | "rating_desc"
  | "title_asc"
  | "title_desc";
type AppView = "library" | "tierlist";

type MediaForm = {
  title: string;
  alternateTitle: string;
  type: MediaType;
  status: MediaStatus;
  priority: MediaPriority;
  tier: MediaTier;
  progress: string;
  totalUnits: string;
  completedSeasons: string;
  completedMovies: string;
  unitLabel: string;
  rating: string;
  review: string;
  notes: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  releaseDate: string;
  reminderDate: string;
  genres: string[];
  tagsText: string;
  provider: string;
  providerId: string;
  externalUrl: string;
};

type SecurityMetrics = {
  security: {
    blocked24h: number;
    rateLimited24h: number;
    unauthorized24h: number;
    crossOrigin24h: number;
    invalidRequests24h: number;
    lastEventAt: string | null;
    auditedChanges24h: number;
  };
  database: {
    status: "healthy" | "attention";
    integrity: string;
    records: number;
    inProgress: number;
    finished: number;
    unranked: number;
  };
  access: { mode: string; authenticated: boolean; ownerVerified: boolean };
};

type MetadataProvider = {
  id: string;
  label: string;
  state: "connected" | "bridge" | "unverified" | "degraded" | "unavailable" | "setup_required";
  detail: string;
  lastCheckedAt: string | null;
};

type MetadataSyncItemError = {
  id: string;
  error: string;
  code: string;
  providers: string[];
  retryAfterAt: string | null;
};

const TYPE_ICONS = {
  anime: Sparkles,
  manga: BookOpen,
  tv: Tv,
  movie: Film,
  game: Gamepad2,
} satisfies Record<MediaType, typeof Tv>;

const TYPE_ACCENTS: Record<MediaType, string> = {
  anime: "violet",
  manga: "rose",
  tv: "cyan",
  movie: "amber",
  game: "emerald",
};

const SOURCE_ROLE_LABELS = {
  catalog: "Catalog",
  schedule: "Schedule",
  description: "Description",
  rating: "Rating",
  identifier: "Matched ID",
} as const;

const PRIORITY_ORDER: Record<MediaPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

const TIER_ORDER: Record<MediaTier, number> = {
  unranked: -1,
  f: 0,
  d: 1,
  c: 2,
  b: 3,
  a: 4,
  s: 5,
};

const BOARD_TIERS: MediaTier[] = ["s", "a", "b", "c", "d", "f", "unranked"];
const SORT_PREFERENCE_KEY = "media-tracker-sort-mode";
const SORT_MODES = new Set<SortMode>([
  "created_desc",
  "created_asc",
  "updated_desc",
  "updated_asc",
  "priority_desc",
  "priority_asc",
  "tier_desc",
  "rating_desc",
  "title_asc",
  "title_desc",
]);
const DEFAULT_COLLECTIONS: MediaCollection[] = [
  { id: "system-continue", name: "Continue watching", kind: "system", filterKey: "continue", sortOrder: 0, mediaItemIds: [], createdAt: "", updatedAt: "" },
  { id: "system-in-progress", name: "In progress", kind: "system", filterKey: "in_progress", sortOrder: 1, mediaItemIds: [], createdAt: "", updatedAt: "" },
  { id: "system-watchlist", name: "Watchlist", kind: "system", filterKey: "watchlist", sortOrder: 2, mediaItemIds: [], createdAt: "", updatedAt: "" },
  { id: "system-finished", name: "Finished", kind: "system", filterKey: "finished", sortOrder: 3, mediaItemIds: [], createdAt: "", updatedAt: "" },
  { id: "system-tierlist", name: "Tier list", kind: "system", filterKey: "tierlist", sortOrder: 4, mediaItemIds: [], createdAt: "", updatedAt: "" },
];

const COLLECTION_ICONS = {
  continue: Play,
  in_progress: Radio,
  watchlist: Library,
  finished: Check,
  tierlist: Trophy,
} satisfies Record<CollectionFilterKey, typeof Tv>;

function isTierListItem(item: MediaItem) {
  const isAnimeSelection = item.type === "anime" || item.tags.includes("Anime tier list");
  return isAnimeSelection && (item.status === "finished" || item.tier !== "unranked");
}

function supportsMetadataSync(item: MediaItem) {
  return MEDIA_TYPES.includes(item.type);
}

function supportsSeriesSchedule(item: MediaItem) {
  return item.type === "anime" || item.type === "tv";
}

function metadataIsStale(item: MediaItem) {
  const retryAfter = Date.parse(item.metadataRetryAfterAt ?? "");
  if (Number.isFinite(retryAfter) && retryAfter > Date.now()) return false;
  if (!item.metadataUpdatedAt || !item.posterUrl || !item.overview) return true;
  if (supportsSeriesSchedule(item) && (
    item.seasonCount === null
    || item.releasedSeasonCount === null
    || item.franchiseInstallments.length === 0
  )) return true;
  const updatedAt = Date.parse(item.metadataUpdatedAt);
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > 12 * 60 * 60 * 1_000;
}

function relativeAiringTime(value: string | null) {
  if (!value) return null;
  const diff = Date.parse(value) - Date.now();
  if (!Number.isFinite(diff)) return null;
  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(hours, "hour");
  }
  const days = Math.round(diff / 86_400_000);
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(days, "day");
}

function liveSummary(item: MediaItem) {
  if (item.scheduleAlert) return { text: item.scheduleAlert, tone: "alert" } as const;
  if (item.nextAiringAt) {
    return {
      text: `${item.nextAiringLabel ?? "Next episode"} ${relativeAiringTime(item.nextAiringAt) ?? "scheduled"}`,
      tone: "live",
    } as const;
  }
  if (item.airingStatus) {
    return { text: AIRING_STATUS_LABELS[item.airingStatus], tone: item.airingStatus === "releasing" ? "live" : "muted" } as const;
  }
  return { text: "Live data not synced", tone: "muted" } as const;
}

function blankForm(type: MediaType = "anime"): MediaForm {
  return {
    title: "",
    alternateTitle: "",
    type,
    status: "watchlist",
    priority: "normal",
    tier: "unranked",
    progress: "0",
    totalUnits: type === "game" ? "100" : "",
    completedSeasons: "",
    completedMovies: "",
    unitLabel: defaultUnit(type),
    rating: "",
    review: "",
    notes: "",
    overview: "",
    posterUrl: "",
    backdropUrl: "",
    releaseDate: "",
    reminderDate: "",
    genres: [],
    tagsText: "",
    provider: "",
    providerId: "",
    externalUrl: "",
  };
}

function formFromItem(item: MediaItem): MediaForm {
  return {
    title: item.title,
    alternateTitle: item.alternateTitle ?? "",
    type: item.type,
    status: item.status,
    priority: item.priority,
    tier: item.tier,
    progress: String(item.progress),
    totalUnits: item.totalUnits === null ? "" : String(item.totalUnits),
    completedSeasons: item.completedSeasons === null ? "" : String(item.completedSeasons),
    completedMovies: item.completedMovies === null ? "" : String(item.completedMovies),
    unitLabel: item.unitLabel,
    rating: item.rating === null ? "" : String(item.rating),
    review: item.review ?? "",
    notes: item.notes ?? "",
    overview: item.overview ?? "",
    posterUrl: item.posterUrl ?? "",
    backdropUrl: item.backdropUrl ?? "",
    releaseDate: item.releaseDate?.slice(0, 10) ?? "",
    reminderDate: item.reminderDate?.slice(0, 10) ?? "",
    genres: item.genres,
    tagsText: item.tags.join(", "),
    provider: item.provider ?? "",
    providerId: item.providerId ?? "",
    externalUrl: item.externalUrl ?? "",
  };
}

function payloadFromForm(form: MediaForm): MediaInput {
  return {
    title: form.title.trim(),
    alternateTitle: form.alternateTitle.trim() || null,
    type: form.type,
    status: form.status,
    priority: form.priority,
    tier: form.tier,
    progress: Math.max(0, Number(form.progress) || 0),
    totalUnits: form.totalUnits === "" ? null : Math.max(0, Number(form.totalUnits) || 0),
    completedSeasons: form.completedSeasons === "" ? null : Math.max(0, Math.round(Number(form.completedSeasons) || 0)),
    completedMovies: form.completedMovies === "" ? null : Math.max(0, Math.round(Number(form.completedMovies) || 0)),
    unitLabel: form.unitLabel.trim() || defaultUnit(form.type),
    rating: form.rating === "" ? null : Math.min(10, Math.max(0, Number(form.rating) || 0)),
    review: form.review.trim() || null,
    notes: form.notes.trim() || null,
    overview: form.overview.trim() || null,
    posterUrl: form.posterUrl.trim() || null,
    backdropUrl: form.backdropUrl.trim() || null,
    releaseDate: form.releaseDate || null,
    reminderDate: form.reminderDate || null,
    genres: form.genres,
    tags: [...new Set(form.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))],
    provider: form.provider || null,
    providerId: form.providerId || null,
    externalUrl: form.externalUrl || null,
  };
}

function progressPercent(item: MediaItem) {
  if (!item.totalUnits || item.totalUnits <= 0) return item.status === "finished" ? 100 : 0;
  return Math.min(100, Math.round((item.progress / item.totalUnits) * 100));
}

function displayRating(item: MediaItem) {
  return item.rating ?? item.communityRating;
}

function formatVotes(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTimestamp(value: string | null) {
  if (!value) return "No blocked requests recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatLibraryTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function relativeReminder(value: string) {
  const target = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function cardFacts(item: MediaItem) {
  const facts: string[] = [];
  if (item.releaseDate) facts.push(item.releaseDate.slice(0, 4));
  if ((item.type === "anime" || item.type === "tv") && item.seasonCount) {
    const released = item.releasedSeasonCount;
    facts.push(released !== null && released < item.seasonCount
      ? `${released} released · ${item.seasonCount} confirmed`
      : `${item.seasonCount} ${item.seasonCount === 1 ? "season" : "seasons"}`);
  } else if (item.status === "in_progress") {
    facts.push(`${item.progress}${item.totalUnits !== null ? `/${item.totalUnits}` : ""} ${item.unitLabel}`);
  }
  return facts.join(" · ") || TYPE_LABELS[item.type];
}

function continuationRank(info: ContinuationInfo) {
  if (info.reason === "available") return 4;
  if (info.reason === "scheduled_episode") return 3;
  if (info.reason === "in_progress") return 2;
  return 1;
}

function shortName(firstName: string | null) {
  return firstName?.trim() || "there";
}

function storedSortMode(value: string | null): SortMode | null {
  if (SORT_MODES.has(value as SortMode)) return value as SortMode;
  if (value === "updated") return "updated_desc";
  if (value === "priority") return "priority_desc";
  if (value === "tier") return "tier_desc";
  if (value === "rating") return "rating_desc";
  if (value === "title") return "title_asc";
  return null;
}

function Poster({ item, className = "" }: { item: MediaItem | DiscoveryResult; className?: string }) {
  const accent = TYPE_ACCENTS[item.type];
  return (
    <div className={`poster poster--${accent} ${className}`}>
      {item.posterUrl ? (
        // External metadata providers return poster URLs rather than user uploads.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="poster__fallback" aria-hidden="true">
          <span>{item.title.slice(0, 1).toUpperCase()}</span>
          <ImageIcon size={18} />
        </div>
      )}
    </div>
  );
}

function ProgressBar({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const percent = progressPercent(item);
  return (
    <div className={`progress ${compact ? "progress--compact" : ""}`}>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={`${item.title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${item.progress}${item.totalUnits !== null ? ` of ${item.totalUnits}` : ""} ${item.unitLabel}, ${percent}% complete`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      {!compact && (
        <div className="progress__meta">
          <span>
            {item.progress}{item.totalUnits !== null ? ` / ${item.totalUnits}` : ""} {item.unitLabel}
          </span>
          <strong>{percent}%</strong>
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="media-grid" role="status" aria-live="polite" aria-label="Loading library">
      <span className="sr-only">Loading your media library.</span>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="skeleton-card" key={index}>
          <div className="skeleton skeleton--poster" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export default function MediaTracker({ firstName }: { firstName: string | null }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<FilterType>("all");
  const [activeStatus, setActiveStatus] = useState<FilterStatus>("all");
  const [activeView, setActiveView] = useState<AppView>("library");
  const [sortMode, setSortMode] = useState<SortMode>("updated_desc");
  const [collections, setCollections] = useState<MediaCollection[]>(DEFAULT_COLLECTIONS);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [confirmingCollectionDeleteId, setConfirmingCollectionDeleteId] = useState<string | null>(null);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);
  const [membershipSavingIds, setMembershipSavingIds] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MediaForm>(blankForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reminderCenterOpen, setReminderCenterOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityMetrics, setSecurityMetrics] = useState<SecurityMetrics | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverTier, setDragOverTier] = useState<MediaTier | null>(null);
  const [savingTierIds, setSavingTierIds] = useState<Set<string>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [metadataProviders, setMetadataProviders] = useState<MetadataProvider[]>([]);
  const [metadataProvidersLoaded, setMetadataProvidersLoaded] = useState(false);
  const [metadataProvidersLoading, setMetadataProvidersLoading] = useState(false);
  const automaticRefreshStarted = useRef(false);
  const metadataProviderRequest = useRef<Promise<void> | null>(null);
  const securityDialogRef = useDialogFocus<HTMLElement>(securityOpen);
  const collectionDialogRef = useDialogFocus<HTMLElement>(collectionManagerOpen);
  const detailDialogRef = useDialogFocus<HTMLElement>(Boolean(detailItem));
  const formDialogRef = useDialogFocus<HTMLElement>(formOpen);
  const imdbConnected = metadataProviders.some((provider) => provider.id === "imdb" && provider.state === "connected");

  const loadItems = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await fetch("/api/media", { cache: "no-store" });
      const data = (await response.json()) as { items?: MediaItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load your library.");
      setItems(data.items ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your library.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const response = await fetch("/api/collections", { cache: "no-store" });
      const data = (await response.json()) as { collections?: MediaCollection[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load collections.");
      setCollections(data.collections?.length ? data.collections : DEFAULT_COLLECTIONS);
      setCollectionError(null);
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Could not load collections.");
    }
  }, []);

  const loadSecurityMetrics = useCallback(async () => {
    setSecurityLoading(true);
    setSecurityError(null);
    try {
      const response = await fetch("/api/security/metrics", { cache: "no-store" });
      const data = (await response.json()) as SecurityMetrics & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not verify security status.");
      setSecurityMetrics(data);
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Could not verify security status.");
    } finally {
      setSecurityLoading(false);
    }
  }, []);

  const loadMetadataProviders = useCallback(() => {
    if (metadataProviderRequest.current) return metadataProviderRequest.current;
    setMetadataProvidersLoading(true);
    const request = (async () => {
      try {
        const response = await fetch("/api/metadata/status", { cache: "no-store" });
        const data = (await response.json()) as { providers?: MetadataProvider[] };
        if (response.ok) setMetadataProviders(data.providers ?? []);
      } catch {
        // Source provenance is also stored per title, so a status check failure
        // should never block the library itself.
      } finally {
        setMetadataProvidersLoaded(true);
        setMetadataProvidersLoading(false);
        metadataProviderRequest.current = null;
      }
    })();
    metadataProviderRequest.current = request;
    return request;
  }, []);

  function openSecurityCenter() {
    setMobileNavOpen(false);
    setSecurityOpen(true);
    void loadSecurityMetrics();
  }

  useEffect(() => {
    let savedSortMode: SortMode | null = null;
    try {
      savedSortMode = storedSortMode(window.localStorage.getItem(SORT_PREFERENCE_KEY));
    } catch {
      // Sorting still works when browser preference storage is unavailable.
    }
    const timer = window.setTimeout(() => {
      if (savedSortMode) setSortMode(savedSortMode);
      void loadItems();
      void loadCollections();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCollections, loadItems]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (reminderCenterOpen) setReminderCenterOpen(false);
      else if (collectionManagerOpen) closeCollectionManager();
      else if (securityOpen) setSecurityOpen(false);
      else if (formOpen) closeForm();
      else if (detailItem) closeDetail();
      else if (mobileNavOpen) setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const modalOpen = collectionManagerOpen || securityOpen || formOpen || Boolean(detailItem);
  useEffect(() => {
    if (!modalOpen) return;
    const background = [...document.querySelectorAll<HTMLElement>(".sidebar, .main-content, .mobile-bottom-nav")];
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    background.forEach((element) => { element.inert = true; });
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element) => { element.inert = false; });
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!formOpen || discoverQuery.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDiscovering(true);
      setDiscoveryError(null);
      setDiscoveryResults([]);
      try {
        const params = new URLSearchParams({ q: discoverQuery.trim(), type: form.type });
        const response = await fetch(`/api/discover?${params}`, { signal: controller.signal });
        const data = (await response.json()) as { results?: DiscoveryResult[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Search is unavailable.");
        setDiscoveryResults(data.results ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setDiscoveryError(error instanceof Error ? error.message : "Search is unavailable.");
          setDiscoveryResults([]);
        }
      } finally {
        setDiscovering(false);
      }
    }, 420);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [discoverQuery, form.type, formOpen]);

  const counts = useMemo(() => {
    const typeCounts = Object.fromEntries(MEDIA_TYPES.map((type) => [type, 0])) as Record<MediaType, number>;
    const statusCounts = Object.fromEntries(MEDIA_STATUSES.map((status) => [status, 0])) as Record<MediaStatus, number>;
    for (const item of items) {
      typeCounts[item.type] += 1;
      statusCounts[item.status] += 1;
    }
    return { type: typeCounts, status: statusCounts };
  }, [items]);

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId && collection.kind === "custom") ?? null,
    [activeCollectionId, collections],
  );

  const customCollections = useMemo(
    () => collections.filter((collection) => collection.kind === "custom"),
    [collections],
  );

  const continueItems = useMemo(() => items
    .map((item) => ({ item, info: continuationForItem(item) }))
    .filter((entry): entry is { item: MediaItem; info: ContinuationInfo } => Boolean(entry.info))
    .sort((left, right) => continuationRank(right.info) - continuationRank(left.info)
      || right.item.updatedAt.localeCompare(left.item.updatedAt)), [items]);

  const detailContinuation = useMemo(
    () => detailItem ? continuationForItem(detailItem) : null,
    [detailItem],
  );

  const detailMovieCounts = useMemo(() => detailItem ? {
    confirmed: detailItem.franchiseInstallments.filter((installment) => installment.kind === "movie").length,
    released: releasedInstallmentCount(detailItem.franchiseInstallments, "movie"),
  } : null, [detailItem]);

  const reminderItems = useMemo(
    () => items
      .filter((item) => item.reminderDate)
      .sort((a, b) => (a.reminderDate ?? "").localeCompare(b.reminderDate ?? "")),
    [items],
  );

  const newlyAddedItems = useMemo(
    () => [...items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6),
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const collectionMemberIds = activeCollection ? new Set(activeCollection.mediaItemIds) : null;
    const filtered = items.filter((item) => {
      const matchesCollection = !collectionMemberIds || collectionMemberIds.has(item.id);
      const matchesType = activeType === "all" || item.type === activeType;
      const matchesStatus = activeStatus === "all"
        || (activeStatus === "continue" ? Boolean(continuationForItem(item)) : item.status === activeStatus);
      const searchable = [item.title, item.alternateTitle, item.notes, item.review, ...item.tags, ...item.genres]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesCollection && matchesType && matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "created_desc") return b.createdAt.localeCompare(a.createdAt);
      if (sortMode === "created_asc") return a.createdAt.localeCompare(b.createdAt);
      if (sortMode === "title_asc") return a.title.localeCompare(b.title);
      if (sortMode === "title_desc") return b.title.localeCompare(a.title);
      if (sortMode === "rating_desc") return (displayRating(b) ?? -1) - (displayRating(a) ?? -1)
        || a.title.localeCompare(b.title);
      if (sortMode === "tier_desc") return TIER_ORDER[b.tier] - TIER_ORDER[a.tier]
        || a.title.localeCompare(b.title);
      if (sortMode === "priority_desc") return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]
        || b.updatedAt.localeCompare(a.updatedAt);
      if (sortMode === "priority_asc") return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        || b.updatedAt.localeCompare(a.updatedAt);
      if (sortMode === "updated_asc") return a.updatedAt.localeCompare(b.updatedAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [activeCollection, activeStatus, activeType, items, query, sortMode]);

  const tierListItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items
      .filter(isTierListItem)
      .filter((item) => !normalizedQuery || [item.title, item.alternateTitle, ...item.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [items, query]);

  const rankedCount = useMemo(
    () => items.filter((item) => isTierListItem(item) && item.tier !== "unranked").length,
    [items],
  );

  const unrankedFinishedCount = useMemo(
    () => items.filter((item) => isTierListItem(item) && item.tier === "unranked").length,
    [items],
  );

  function selectType(type: FilterType) {
    setActiveView("library");
    setActiveType(type);
    setActiveStatus("all");
    setActiveCollectionId(null);
    setMobileNavOpen(false);
  }

  function selectStatus(status: FilterStatus) {
    setActiveView("library");
    setActiveType("all");
    setActiveStatus(status);
    setActiveCollectionId(null);
    setMobileNavOpen(false);
    window.setTimeout(() => document.getElementById("library")?.scrollIntoView({ behavior: "smooth" }), 10);
  }

  function openTierList() {
    setActiveView("tierlist");
    setActiveType("all");
    setActiveStatus("all");
    setActiveCollectionId(null);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectCollection(id: string) {
    setActiveView("library");
    setActiveType("all");
    setActiveStatus("all");
    setActiveCollectionId(id);
    setMobileNavOpen(false);
    window.setTimeout(() => document.getElementById("library")?.scrollIntoView({ behavior: "smooth" }), 10);
  }

  function changeSortMode(mode: SortMode) {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_PREFERENCE_KEY, mode);
    } catch {
      // The selected order remains active for this session.
    }
  }

  function openNavigationCollection(collection: MediaCollection) {
    if (collection.kind === "custom") {
      selectCollection(collection.id);
      return;
    }
    if (collection.filterKey === "tierlist") openTierList();
    else if (collection.filterKey) selectStatus(collection.filterKey);
  }

  function collectionIsActive(collection: MediaCollection) {
    if (collection.kind === "custom") {
      return activeView === "library" && activeCollectionId === collection.id;
    }
    if (collection.filterKey === "tierlist") return activeView === "tierlist";
    return activeView === "library" && !activeCollectionId && activeStatus === collection.filterKey;
  }

  function collectionCount(collection: MediaCollection) {
    if (collection.kind === "custom") return collection.mediaItemIds.length;
    if (collection.filterKey === "continue") return continueItems.length;
    if (collection.filterKey === "in_progress") return counts.status.in_progress;
    if (collection.filterKey === "watchlist") return counts.status.watchlist;
    if (collection.filterKey === "finished") return counts.status.finished;
    if (collection.filterKey === "tierlist") return rankedCount;
    return 0;
  }

  function openNew(type?: MediaType) {
    const nextType = type ?? (activeType === "all" ? "anime" : activeType);
    setEditingId(null);
    setForm(blankForm(nextType));
    setDiscoverQuery("");
    setDiscoveryResults([]);
    setDiscoveryError(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(item: MediaItem) {
    setEditingId(item.id);
    setForm(formFromItem(item));
    setDiscoverQuery(item.title);
    setDiscoveryResults([]);
    setDiscoveryError(null);
    setFormError(null);
    setDetailItem(null);
    setConfirmingDeleteId(null);
    setFormOpen(true);
  }

  function closeDetail() {
    setDetailItem(null);
    setConfirmingDeleteId(null);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
    setDiscoverQuery("");
    setDiscoveryResults([]);
  }

  function changeFormType(type: MediaType) {
    setForm((current) => ({
      ...current,
      type,
      unitLabel: defaultUnit(type),
      totalUnits: type === "game" && !current.totalUnits ? "100" : current.totalUnits,
    }));
    setDiscoveryResults([]);
  }

  function applyDiscovery(result: DiscoveryResult) {
    setForm((current) => ({
      ...current,
      title: result.title,
      alternateTitle: result.alternateTitle ?? "",
      type: result.type,
      overview: result.overview ?? "",
      posterUrl: result.posterUrl ?? "",
      backdropUrl: result.backdropUrl ?? "",
      releaseDate: result.releaseDate?.slice(0, 10) ?? "",
      totalUnits: result.totalUnits === null ? current.totalUnits : String(result.totalUnits),
      unitLabel: result.unitLabel,
      genres: result.genres,
      provider: result.provider,
      providerId: result.providerId,
      externalUrl: result.externalUrl ?? "",
    }));
    setDiscoverQuery(result.title);
    setDiscoveryResults([]);
  }

  async function saveForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      setFormError("Give this item a title before saving.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const endpoint = editingId ? `/api/media/${editingId}` : "/api/media";
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFromForm(form)),
      });
      const data = (await response.json()) as { item?: MediaItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || "Could not save this item.");
      setItems((current) => {
        const without = current.filter((item) => item.id !== data.item?.id);
        return [data.item!, ...without];
      });
      setFormOpen(false);
      setEditingId(null);
      if (metadataIsStale(data.item)) {
        window.setTimeout(() => void syncSingle(data.item!, true), 0);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save this item.");
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(item: MediaItem, changes: Partial<MediaItem>) {
    const optimistic = { ...item, ...changes, updatedAt: new Date().toISOString() };
    setItems((current) => current.map((entry) => entry.id === item.id ? optimistic : entry));
    if (detailItem?.id === item.id) setDetailItem(optimistic);
    try {
      const formPayload = payloadFromForm(formFromItem(optimistic));
      const response = await fetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formPayload),
      });
      const data = (await response.json()) as { item?: MediaItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || "Update failed.");
      setItems((current) => current.map((entry) => entry.id === item.id ? data.item! : entry));
      if (detailItem?.id === item.id) setDetailItem(data.item);
    } catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
      if (detailItem?.id === item.id) setDetailItem(item);
      setLoadError("That update did not save. Please try again.");
    }
  }

  async function markCaughtUp(item: MediaItem) {
    await updateItem(item, {
      status: "finished",
      completedSeasons: item.releasedSeasonCount ?? item.completedSeasons,
      completedMovies: releasedInstallmentCount(item.franchiseInstallments, "movie"),
      progress: item.availableUnits ?? item.totalUnits ?? item.progress,
    });
  }

  function mergeSyncedItems(synced: MediaItem[]) {
    if (!synced.length) return;
    const byId = new Map(synced.map((item) => [item.id, item]));
    setItems((current) => current.map((item) => byId.get(item.id) ?? item));
    setDetailItem((current) => current ? byId.get(current.id) ?? current : null);
  }

  async function syncMetadataBatch(ids: string[]) {
    if (!ids.length) return { synced: 0, failed: 0, errors: [] as MetadataSyncItemError[] };
    setSyncingIds((current) => new Set([...current, ...ids]));
    try {
      const response = await fetch("/api/media/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json()) as {
        items?: MediaItem[];
        failedItems?: MediaItem[];
        errors?: MetadataSyncItemError[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Live data could not be refreshed.");
      mergeSyncedItems([...(data.items ?? []), ...(data.failedItems ?? [])]);
      return {
        synced: data.items?.length ?? 0,
        failed: data.errors?.length ?? 0,
        errors: data.errors ?? [],
      };
    } finally {
      setSyncingIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  async function syncSingle(item: MediaItem, quiet = false) {
    if (!supportsMetadataSync(item) || syncingIds.has(item.id)) return;
    if (!quiet) {
      setSyncProgress(null);
      setMetadataMessage(`Refreshing ${item.title}…`);
    }
    try {
      const result = await syncMetadataBatch([item.id]);
      if (!quiet) {
        setMetadataMessage(result.synced
          ? `${item.title} now has refreshed artwork, description, ratings, seasons, and schedule data.`
          : result.errors[0]?.error ?? `A reliable metadata match was not found for ${item.title}.`);
      }
    } catch (error) {
      if (!quiet) setMetadataMessage(error instanceof Error ? error.message : "Live data could not be refreshed.");
    } finally {
      void loadMetadataProviders();
    }
  }

  async function syncTierListMetadata() {
    if (bulkSyncing) return;
    await syncMetadataCollection(
      tierListItems.filter(supportsMetadataSync),
      "tier-list",
    );
  }

  async function syncLibraryMetadata() {
    if (bulkSyncing) return;
    await syncMetadataCollection(items.filter(supportsMetadataSync), "library");
  }

  async function syncMetadataCollection(targets: MediaItem[], label: "library" | "tier-list") {
    setBulkSyncing(true);
    setMetadataMessage(null);
    setSyncProgress({ done: 0, total: targets.length });
    let synced = 0;
    let failed = 0;
    let firstFailureMessage: string | null = null;
    try {
      for (let index = 0; index < targets.length; index += 8) {
        const batch = targets.slice(index, index + 8);
        try {
          const result = await syncMetadataBatch(batch.map((item) => item.id));
          synced += result.synced;
          failed += result.failed;
          firstFailureMessage ??= result.errors[0]?.error ?? null;
        } catch {
          failed += batch.length;
        }
        setSyncProgress({ done: Math.min(index + batch.length, targets.length), total: targets.length });
      }
      setMetadataMessage(failed
        ? `Updated ${synced} titles; ${failed} were left unchanged. ${firstFailureMessage ?? "Some metadata providers could not complete the request."}`
        : `Updated descriptions, artwork, ratings, seasons, and live data for all ${synced} ${label} titles.`);
    } finally {
      setBulkSyncing(false);
      void loadMetadataProviders();
    }
  }

  useEffect(() => {
    if (loading || bulkSyncing || automaticRefreshStarted.current || !items.length) return;
    const timer = window.setTimeout(() => {
      automaticRefreshStarted.current = true;
      const staleFinishedSeries = items.filter((item) => item.status === "finished"
        && supportsSeriesSchedule(item)
        && metadataIsStale(item));
      if (staleFinishedSeries.length) void syncMetadataCollection(staleFinishedSeries, "library");
    }, 1_200);
    // This refresh intentionally runs once, after the initial library becomes interactive.
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkSyncing, items, loading]);

  function openDetail(item: MediaItem) {
    setDetailItem(item);
    setConfirmingDeleteId(null);
    if (item.imdbId && !metadataProvidersLoaded) void loadMetadataProviders();
    if (supportsMetadataSync(item) && metadataIsStale(item) && !syncingIds.has(item.id)) {
      window.setTimeout(() => void syncSingle(item, true), 0);
    }
  }

  async function moveToTier(item: MediaItem, tier: MediaTier) {
    if (item.tier === tier || savingTierIds.has(item.id)) return;
    const optimistic = { ...item, tier, updatedAt: new Date().toISOString() };
    setSavingTierIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((entry) => entry.id === item.id ? optimistic : entry));
    setDetailItem((current) => current?.id === item.id ? optimistic : current);
    try {
      const response = await fetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await response.json()) as { item?: MediaItem; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error || "Tier update failed.");
      mergeSyncedItems([data.item]);
    } catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, tier: item.tier } : entry));
      setDetailItem((current) => current?.id === item.id ? { ...current, tier: item.tier } : current);
      setLoadError("That tier change did not save. Please try again.");
    } finally {
      setSavingTierIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  function dropOnTier(event: React.DragEvent<HTMLElement>, tier: MediaTier) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggingId;
    const item = items.find((entry) => entry.id === id);
    if (item) void moveToTier(item, tier);
    setDraggingId(null);
    setDragOverTier(null);
  }

  async function incrementProgress(item: MediaItem, amount: number) {
    const cap = item.totalUnits ?? Number.MAX_SAFE_INTEGER;
    const progress = Math.max(0, Math.min(cap, item.progress + amount));
    const shouldFinish = item.totalUnits !== null && item.totalUnits > 0 && progress >= item.totalUnits;
    await updateItem(item, { progress, status: shouldFinish ? "finished" : "in_progress" });
  }

  async function removeItem(item: MediaItem) {
    try {
      const response = await fetch(`/api/media/${item.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed.");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setDetailItem(null);
      setConfirmingDeleteId(null);
      if (editingId === item.id) closeForm();
    } catch {
      setLoadError("Could not remove that item. Please try again.");
    }
  }

  function openCollectionManager() {
    setMobileNavOpen(false);
    setCollectionManagerOpen(true);
    setCollectionError(null);
    setConfirmingCollectionDeleteId(null);
  }

  function closeCollectionManager() {
    if (collectionSaving) return;
    setCollectionManagerOpen(false);
    setEditingCollectionId(null);
    setEditingCollectionName("");
    setConfirmingCollectionDeleteId(null);
    setDraggingCollectionId(null);
    setDragOverCollectionId(null);
    setCollectionError(null);
  }

  async function createCollection(event: React.FormEvent) {
    event.preventDefault();
    if (!newCollectionName.trim() || collectionSaving) return;
    setCollectionSaving(true);
    setCollectionError(null);
    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newCollectionName }),
      });
      const data = (await response.json()) as { collection?: MediaCollection; error?: string };
      if (!response.ok || !data.collection) throw new Error(data.error || "Could not create the collection.");
      setCollections((current) => [...current, data.collection!]);
      setNewCollectionName("");
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Could not create the collection.");
    } finally {
      setCollectionSaving(false);
    }
  }

  function beginCollectionRename(collection: MediaCollection) {
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
    setConfirmingCollectionDeleteId(null);
    setCollectionError(null);
  }

  async function saveCollectionRename(event: React.FormEvent) {
    event.preventDefault();
    if (!editingCollectionId || !editingCollectionName.trim() || collectionSaving) return;
    const currentCollection = collections.find((collection) => collection.id === editingCollectionId);
    if (!currentCollection) return;
    if (editingCollectionName.trim() === currentCollection.name) {
      setEditingCollectionId(null);
      return;
    }
    setCollectionSaving(true);
    setCollectionError(null);
    try {
      const response = await fetch(`/api/collections/${editingCollectionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editingCollectionName }),
      });
      const data = (await response.json()) as { collection?: MediaCollection; error?: string };
      if (!response.ok || !data.collection) throw new Error(data.error || "Could not rename the collection.");
      setCollections((current) => current.map((collection) => collection.id === editingCollectionId
        ? { ...data.collection!, mediaItemIds: collection.mediaItemIds }
        : collection));
      setEditingCollectionId(null);
      setEditingCollectionName("");
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Could not rename the collection.");
    } finally {
      setCollectionSaving(false);
    }
  }

  async function deleteCollection(id: string) {
    if (collectionSaving) return;
    setCollectionSaving(true);
    setCollectionError(null);
    try {
      const response = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      const data = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "Could not remove the collection.");
      setCollections((current) => current.filter((collection) => collection.id !== id));
      if (activeCollectionId === id) setActiveCollectionId(null);
      setConfirmingCollectionDeleteId(null);
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Could not remove the collection.");
    } finally {
      setCollectionSaving(false);
    }
  }

  async function saveCollectionOrder(nextCollections: MediaCollection[]) {
    if (collectionSaving) return;
    const previous = collections;
    const ordered = nextCollections.map((collection, index) => ({ ...collection, sortOrder: index }));
    setCollections(ordered);
    setCollectionSaving(true);
    setCollectionError(null);
    try {
      const response = await fetch("/api/collections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((collection) => collection.id) }),
      });
      const data = (await response.json()) as { orderedIds?: string[]; error?: string };
      if (!response.ok || !data.orderedIds) throw new Error(data.error || "Could not save collection order.");
    } catch (error) {
      setCollections(previous);
      setCollectionError(error instanceof Error ? error.message : "Could not save collection order.");
    } finally {
      setCollectionSaving(false);
    }
  }

  function moveCollection(id: string, direction: -1 | 1) {
    const index = collections.findIndex((collection) => collection.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= collections.length || collectionSaving) return;
    const next = [...collections];
    [next[index], next[target]] = [next[target], next[index]];
    void saveCollectionOrder(next);
  }

  function dropCollection(targetId: string) {
    if (!draggingCollectionId || draggingCollectionId === targetId || collectionSaving) return;
    const sourceIndex = collections.findIndex((collection) => collection.id === draggingCollectionId);
    const originalTargetIndex = collections.findIndex((collection) => collection.id === targetId);
    const dragged = collections.find((collection) => collection.id === draggingCollectionId);
    if (!dragged || sourceIndex < 0 || originalTargetIndex < 0) return;
    const next = collections.filter((collection) => collection.id !== draggingCollectionId);
    const targetIndex = next.findIndex((collection) => collection.id === targetId);
    const insertionIndex = sourceIndex < originalTargetIndex ? targetIndex + 1 : targetIndex;
    next.splice(Math.max(0, insertionIndex), 0, dragged);
    setDraggingCollectionId(null);
    setDragOverCollectionId(null);
    void saveCollectionOrder(next);
  }

  async function toggleItemCollection(item: MediaItem, collectionId: string) {
    if (membershipSavingIds.has(item.id)) return;
    const previous = collections;
    const selected = customCollections
      .filter((collection) => collection.id === collectionId
        ? !collection.mediaItemIds.includes(item.id)
        : collection.mediaItemIds.includes(item.id))
      .map((collection) => collection.id);
    setCollections((current) => current.map((collection) => {
      if (collection.kind !== "custom") return collection;
      const shouldInclude = selected.includes(collection.id);
      const mediaItemIds = shouldInclude
        ? [...new Set([...collection.mediaItemIds, item.id])]
        : collection.mediaItemIds.filter((id) => id !== item.id);
      return { ...collection, mediaItemIds };
    }));
    setMembershipSavingIds((current) => new Set(current).add(item.id));
    try {
      const response = await fetch(`/api/media/${item.id}/collections`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectionIds: selected }),
      });
      const data = (await response.json()) as { collectionIds?: string[]; error?: string };
      if (!response.ok || !data.collectionIds) throw new Error(data.error || "Could not update collections.");
    } catch (error) {
      setCollections(previous);
      setLoadError(error instanceof Error ? error.message : "Could not update collections.");
    } finally {
      setMembershipSavingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`}>
        <div className="brand">
          <span className="brand__mark"><Clapperboard size={19} /></span>
          <div><strong>Media</strong><span>Tracker</span></div>
          <button className="icon-button sidebar__close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Media library navigation">
          <p className="side-label">Library</p>
          <button
            className={activeView === "library" && !activeCollectionId && activeType === "all" && activeStatus === "all" ? "active" : ""}
            onClick={() => selectType("all")}
            aria-current={activeView === "library" && !activeCollectionId && activeType === "all" && activeStatus === "all" ? "page" : undefined}
          >
            <LayoutGrid size={17} /><span>All media</span><em>{items.length}</em>
          </button>
          {MEDIA_TYPES.map((type) => {
            const Icon = TYPE_ICONS[type];
            return (
              <button
                key={type}
                className={activeView === "library" && activeType === type && activeStatus === "all" ? "active" : ""}
                onClick={() => selectType(type)}
                aria-current={activeView === "library" && activeType === type && activeStatus === "all" ? "page" : undefined}
              >
                <Icon size={17} /><span>{TYPE_LABELS[type]}</span><em>{counts.type[type]}</em>
              </button>
            );
          })}
          <div className="side-label-row">
            <p className="side-label">Collections</p>
            <button className="side-label-action" onClick={openCollectionManager} aria-label="Manage collections" title="Manage collections">
              <Settings2 size={13} />
            </button>
          </div>
          {collections.map((collection) => {
            const Icon = collection.kind === "custom" || !collection.filterKey
              ? Folder
              : COLLECTION_ICONS[collection.filterKey];
            return (
              <button
                key={collection.id}
                className={collectionIsActive(collection) ? "active" : ""}
                onClick={() => openNavigationCollection(collection)}
                aria-current={collectionIsActive(collection) ? "page" : undefined}
              >
                <Icon size={17} /><span>{collection.name}</span><em>{collectionCount(collection)}</em>
              </button>
            );
          })}
        </nav>

        <button className="sidebar__security" onClick={openSecurityCenter}>
          <span><ShieldCheck size={18} /></span>
          <div><strong>Security center</strong><small>Owner-only · protected</small></div>
          <em>{securityMetrics?.security.blocked24h ?? 0}</em>
        </button>
        <div className="sidebar__profile">
          <span><CircleUserRound size={20} /></span>
          <div><strong>{firstName ?? "My library"}</strong><small>Private collection</small></div>
          <span className="privacy-dot" title="Owner-only access" />
        </div>
      </aside>

      {mobileNavOpen && <button className="nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}

      <main className="main-content" aria-busy={loading}>
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><LayoutGrid size={20} /></button>
          <div className="top-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={activeView === "tierlist" ? "Search your tier list" : "Search your library"}
              aria-label={activeView === "tierlist" ? "Search your tier list" : "Search your library"}
            />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
          </div>
          <ReminderCenter
            items={reminderItems}
            open={reminderCenterOpen}
            onOpenChange={setReminderCenterOpen}
            onOpenItem={(id) => {
              const item = items.find((entry) => entry.id === id);
              if (item) openDetail(item);
            }}
            onAdd={() => openNew()}
          />
          <button className="primary-button" onClick={() => openNew()}><Plus size={18} /><span>Add media</span></button>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">{activeView === "tierlist" ? "Anime favorites" : "Your private library"}</p>
              <h1>{activeView === "tierlist" ? "Your tier list." : `Welcome back, ${shortName(firstName)}.`}</h1>
              <p>{activeView === "tierlist"
                ? "Drag any finished anime into a tier, or use each card’s selector on touch and keyboard."
                : "Pick up where you left off or shape what comes next."}</p>
            </div>
            <div className="quick-stats" aria-label={activeView === "tierlist" ? "Tier list overview" : "Library overview"}>
              {activeView === "tierlist" ? (
                <>
                  <div><strong>{rankedCount}</strong><span>Ranked</span></div>
                  <div><strong>{unrankedFinishedCount}</strong><span>Unranked</span></div>
                  <div><strong>{tierListItems.filter((item) => item.metadataUpdatedAt).length}</strong><span>Live data</span></div>
                </>
              ) : (
                <>
                  <div><strong>{items.length}</strong><span>Total</span></div>
                  <div><strong>{continueItems.length}</strong><span>Continue</span></div>
                  <div><strong>{counts.status.finished}</strong><span>Finished</span></div>
                </>
              )}
            </div>
          </section>

          {loadError && (
            <div className="error-banner" role="alert">
              <span>{loadError}</span>
              <button onClick={() => { setLoadError(null); void loadItems(); }}>Try again</button>
            </div>
          )}

          {activeView === "library" ? <>
          {!query && !activeCollection && activeType === "all" && activeStatus === "all" && (
            <>
              <section className="dashboard-section continue-section">
                <div className="section-heading">
                  <div><p className="eyebrow">Resume or catch up</p><h2>Continue watching</h2></div>
                  {continueItems.length > 0 && <button className="text-button" onClick={() => selectStatus("continue")}>View all <ChevronRight size={16} /></button>}
                </div>
                {loading ? (
                  <div className="continue-grid"><div className="skeleton skeleton--continue" /><div className="skeleton skeleton--continue" /></div>
                ) : continueItems.length ? (
                  <div className="continue-grid">
                    {continueItems.slice(0, 4).map(({ item, info }) => (
                      <button className={`continue-card accent-${TYPE_ACCENTS[item.type]}`} key={item.id} onClick={() => openDetail(item)}>
                        <Poster item={item} className="continue-card__poster" />
                        <div className="continue-card__body">
                          <span className={`continue-card__label continue-card__label--${info.reason}`}>
                            {info.reason === "in_progress" ? <Play size={12} fill="currentColor" /> : <Sparkles size={12} />}
                            {info.label}
                          </span>
                          <h3>{item.title}</h3>
                          <p>{info.detail}</p>
                          {info.reason === "in_progress" ? <ProgressBar item={item} compact /> : (
                            <span className="continue-card__caught-up">Finished entry · more content detected</span>
                          )}
                        </div>
                        <span className="continue-card__arrow"><ChevronRight size={17} /></span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="continue-empty">
                    <span className="continue-empty__icon"><Play size={19} /></span>
                    <div><strong>Nothing needs continuing</strong><p>In-progress titles and finished series with new content will appear here.</p></div>
                    <button className="secondary-button" onClick={() => selectStatus("watchlist")}>Open watchlist</button>
                  </div>
                )}
              </section>

              <section className="dashboard-section reminders-section">
                <div className="section-heading section-heading--compact">
                  <div><p className="eyebrow">Dates that matter</p><h2>Up next</h2></div>
                </div>
                {reminderItems.length ? (
                  <div className="reminder-grid">
                    {reminderItems.map((item) => (
                      <button key={item.id} className="reminder-card" onClick={() => openDetail(item)}>
                        <span className={`reminder-card__icon accent-${TYPE_ACCENTS[item.type]}`}><CalendarDays size={18} /></span>
                        <div><strong>{item.title}</strong><span>{item.reminderDate && relativeReminder(item.reminderDate)} · {formatDate(item.reminderDate)}</span></div>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <button className="reminder-empty" onClick={() => openNew()}>
                    <Bell size={17} /><span><strong>No reminders set</strong> Add a reminder to any title and it will appear here.</span><ChevronRight size={16} />
                  </button>
                )}
              </section>

              <section className="dashboard-section newly-added-section">
                <div className="section-heading">
                  <div><p className="eyebrow">Fresh in your library</p><h2>Newly added</h2></div>
                  {newlyAddedItems.length > 0 && (
                    <button className="text-button" onClick={() => {
                      changeSortMode("created_desc");
                      document.getElementById("library")?.scrollIntoView({ behavior: "smooth" });
                    }}>View all by date <ChevronRight size={16} /></button>
                  )}
                </div>
                {loading ? (
                  <div className="newly-added-grid" aria-label="Loading newly added titles">
                    {Array.from({ length: 3 }).map((_, index) => <div className="skeleton skeleton--recent" key={index} />)}
                  </div>
                ) : newlyAddedItems.length ? (
                  <div className="newly-added-grid">
                    {newlyAddedItems.map((item) => (
                      <button className="newly-added-card" key={item.id} onClick={() => openDetail(item)}>
                        <Poster item={item} className="newly-added-card__poster" />
                        <span className="newly-added-card__copy">
                          <strong>{item.title}</strong>
                          <small><Clock3 size={11} /> Added {formatLibraryTimestamp(item.createdAt)}</small>
                          <em>{TYPE_LABELS[item.type]} · {STATUS_LABELS[item.status]}</em>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <button className="reminder-empty" onClick={() => openNew()}>
                    <Plus size={17} /><span><strong>No titles added yet</strong> Your newest additions will appear here.</span><ChevronRight size={16} />
                  </button>
                )}
              </section>
            </>
          )}

          <section className="library-section" id="library">
            <div className="section-heading library-heading">
              <div>
                <p className="eyebrow">{activeCollection ? "Custom collection" : "Organized your way"}</p>
                <h2>{activeCollection
                  ? activeCollection.name
                  : activeStatus === "continue"
                  ? "Continue Watching"
                  : activeStatus !== "all"
                    ? STATUS_LABELS[activeStatus]
                    : activeType === "all" ? "Library" : TYPE_LABELS[activeType]}</h2>
              </div>
              <span className="result-count">{filteredItems.length} {filteredItems.length === 1 ? "title" : "titles"}</span>
            </div>

            <div className="library-toolbar">
              <div className="filter-pills" role="group" aria-label="Filter by status">
                <button className={activeStatus === "all" ? "active" : ""} onClick={() => setActiveStatus("all")} aria-pressed={activeStatus === "all"}>All</button>
                <button className={activeStatus === "continue" ? "active" : ""} onClick={() => setActiveStatus("continue")} aria-pressed={activeStatus === "continue"}>Continue watching</button>
                {MEDIA_STATUSES.map((status) => (
                  <button key={status} className={activeStatus === status ? "active" : ""} onClick={() => setActiveStatus(status)} aria-pressed={activeStatus === status}>{STATUS_LABELS[status]}</button>
                ))}
              </div>
              <div className="library-toolbar__actions">
                <button className="secondary-button library-sync-button" onClick={() => void syncLibraryMetadata()} disabled={bulkSyncing || loading || !items.length}>
                  {bulkSyncing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                  {bulkSyncing && syncProgress ? `${syncProgress.done}/${syncProgress.total}` : "Refresh metadata"}
                </button>
                <label className="sort-select">
                  <span className="sort-select__prefix"><ArrowUpDown size={13} /> Sort</span>
                  <select value={sortMode} onChange={(event) => changeSortMode(event.target.value as SortMode)} aria-label="Sort library">
                    <option value="created_desc">Recently added</option>
                    <option value="created_asc">Oldest added</option>
                    <option value="updated_desc">Recently updated</option>
                    <option value="updated_asc">Oldest updated</option>
                    <option value="priority_desc">Priority · highest first</option>
                    <option value="priority_asc">Priority · lowest first</option>
                    <option value="tier_desc">Tier · S first</option>
                    <option value="rating_desc">Rating · high first</option>
                    <option value="title_asc">Title · A–Z</option>
                    <option value="title_desc">Title · Z–A</option>
                  </select>
                  <ChevronDown className="sort-select__chevron" size={15} />
                </label>
              </div>
            </div>

            <details
              className="metadata-provider-panel"
              onToggle={(event) => {
                if (event.currentTarget.open && !metadataProvidersLoaded) void loadMetadataProviders();
              }}
            >
                <summary>
                  <Database size={14} />
                  <span>Metadata sources</span>
                  <em>{metadataProvidersLoading
                    ? "Checking"
                    : metadataProvidersLoaded
                      ? `${metadataProviders.filter((provider) => !["setup_required", "unavailable"].includes(provider.state)).length} active`
                      : "Open to check"}</em>
                  <ChevronDown size={13} />
                </summary>
                <div className="metadata-provider-grid" aria-live="polite">
                  {metadataProvidersLoading ? (
                    <div className="metadata-provider-state"><LoaderCircle className="spin" size={15} /> Checking source health…</div>
                  ) : metadataProviders.length ? metadataProviders.map((provider) => (
                    <div key={provider.id} className={`metadata-provider metadata-provider--${provider.state}`}>
                      <span><i />{provider.label}</span>
                      <small>{provider.detail}</small>
                    </div>
                  )) : (
                    <div className="metadata-provider-state">Source health has not been checked in this session.</div>
                  )}
                </div>
              </details>

            {(metadataMessage || bulkSyncing) && (
              <div className="library-sync-status" aria-live="polite">
                <span>{metadataMessage ?? "Checking descriptions, posters, ratings, and current schedules…"}</span>
                {syncProgress && (
                  <div className="tier-sync-progress" aria-label={`${syncProgress.done} of ${syncProgress.total} titles checked`}>
                    <span style={{ width: `${syncProgress.total ? (syncProgress.done / syncProgress.total) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
            )}

            {loading ? <SkeletonGrid /> : filteredItems.length ? (
              <div className="media-grid">
                {filteredItems.map((item) => {
                  const continuation = continuationForItem(item);
                  return <article className="media-card" key={item.id}>
                    <button className="media-card__open" onClick={() => openDetail(item)} aria-label={`Open ${item.title}`}>
                      <Poster item={item} />
                      <span className={`type-badge accent-${TYPE_ACCENTS[item.type]}`}>{TYPE_LABELS[item.type]}</span>
                      {displayRating(item) !== null && (
                        <span className={`rating-badge ${item.rating === null ? "rating-badge--community" : ""}`} title={item.rating === null ? `${item.ratingSource ?? "Community"} rating` : "Your rating"}>
                          <Star size={11} fill="currentColor" /> {displayRating(item)?.toFixed(1)}
                        </span>
                      )}
                      {continuation && continuation.reason !== "in_progress" && (
                        <span className={`availability-badge availability-badge--${continuation.reason}`}>
                          <Sparkles size={10} /> {continuation.reason === "available" ? "More available" : continuation.reason === "scheduled_episode" ? "Episode scheduled" : "Next confirmed"}
                        </span>
                      )}
                      <div className="media-card__popover">
                        <div className="popover-top">
                          <span>{continuation?.label ?? STATUS_LABELS[item.status]}</span>
                          <em>{item.tier === "unranked" ? PRIORITY_LABELS[item.priority] : TIER_LABELS[item.tier]}</em>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.overview || item.notes || "Open this title to add your progress, notes, and review."}</p>
                        {item.genres.length > 0 && <div className="mini-tags">{item.genres.slice(0, 3).map((genre) => <span key={genre}>{genre}</span>)}</div>}
                        <span className="open-prompt">Open details <ChevronRight size={14} /></span>
                      </div>
                    </button>
                    <div className="media-card__caption">
                      <div className="media-card__copy">
                        <div className="media-card__title-row">
                          <h3 title={item.title}>{item.title}</h3>
                          <button className="icon-button" onClick={() => openEdit(item)} aria-label={`Edit ${item.title}`}><Pencil size={14} /></button>
                        </div>
                        <p>{cardFacts(item)}</p>
                        <p className="media-card__date">Added {formatLibraryTimestamp(item.createdAt)}</p>
                        <div className="media-card__state">
                          <span>{STATUS_LABELS[item.status]}</span>
                          {item.tier !== "unranked" && <em>{TIER_LABELS[item.tier]}</em>}
                        </div>
                      </div>
                    </div>
                    <div className="media-card__progress-slot">
                      {item.status === "in_progress" && <ProgressBar item={item} compact />}
                    </div>
                  </article>;
                })}
              </div>
            ) : (
              <div className="library-empty">
                <span>{activeCollection ? <Folder size={26} /> : <Library size={26} />}</span>
                <h3>{query
                  ? "No matching titles"
                  : activeCollection && activeStatus !== "all"
                    ? "No titles in this view"
                    : activeCollection
                      ? `${activeCollection.name} is empty`
                      : "This shelf is empty"}</h3>
                <p>{query
                  ? "Try a different search or clear your filters."
                  : activeCollection && activeStatus !== "all"
                    ? "Try another status or return to everything in this collection."
                  : activeCollection
                    ? "Open a title and add it to this collection from its details."
                    : "Add something new or choose another section."}</p>
                <button className="primary-button" onClick={() => query
                  ? setQuery("")
                  : activeCollection && activeStatus !== "all"
                    ? setActiveStatus("all")
                  : activeCollection
                    ? selectType("all")
                    : openNew()}>{query
                      ? "Clear search"
                      : activeCollection && activeStatus !== "all"
                        ? "Clear status filter"
                        : activeCollection
                          ? "Browse all media"
                          : "Add media"}</button>
              </div>
            )}
          </section>
          </> : (
            <section className="tierlist-workspace" aria-labelledby="tierlist-heading">
              <div className="tierlist-toolbar">
                <div>
                  <p className="eyebrow">Personal ranking</p>
                  <h2 id="tierlist-heading">Ranking board</h2>
                  <p>Finished anime automatically appear in Unranked. Your older incomplete favorites stay visible in their assigned tiers.</p>
                </div>
                <button className="secondary-button tier-sync-button" onClick={() => void syncTierListMetadata()} disabled={bulkSyncing || loading}>
                  {bulkSyncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                  {bulkSyncing && syncProgress
                    ? `Syncing ${syncProgress.done}/${syncProgress.total}`
                    : "Sync posters & live data"}
                </button>
              </div>

              {(metadataMessage || bulkSyncing) && (
                <div className="tier-sync-status" aria-live="polite">
                  <span>{metadataMessage ?? "Checking posters, seasons, and current schedules…"}</span>
                  {syncProgress && (
                    <div className="tier-sync-progress" aria-label={`${syncProgress.done} of ${syncProgress.total} titles checked`}>
                      <span style={{ width: `${syncProgress.total ? (syncProgress.done / syncProgress.total) * 100 : 0}%` }} />
                    </div>
                  )}
                </div>
              )}

              {loading ? <SkeletonGrid /> : (
                <div className="tier-board">
                  {BOARD_TIERS.map((tier) => {
                    const tierItems = tierListItems.filter((item) => item.tier === tier);
                    const tierName = tier === "unranked" ? "?" : tier.toUpperCase();
                    return (
                      <section
                        className={`tier-row tier-row--${tier} ${dragOverTier === tier ? "tier-row--over" : ""}`}
                        key={tier}
                        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverTier(tier); }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverTier(null);
                        }}
                        onDrop={(event) => dropOnTier(event, tier)}
                        aria-label={`${TIER_LABELS[tier]} drop zone`}
                      >
                        <div className="tier-row__label" title={TIER_LABELS[tier]}>
                          <strong>{tierName}</strong>
                          <span>{tier === "unranked" ? "Pool" : "Tier"}</span>
                        </div>
                        <div className="tier-row__content">
                          {tierItems.map((item) => {
                            const summary = liveSummary(item);
                            const syncing = syncingIds.has(item.id);
                            const savingTier = savingTierIds.has(item.id);
                            return (
                              <article
                                className={`tier-card ${draggingId === item.id ? "tier-card--dragging" : ""} ${savingTier ? "tier-card--saving" : ""}`}
                                draggable={!savingTier}
                                key={item.id}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", item.id);
                                  setDraggingId(item.id);
                                }}
                                onDragEnd={() => { setDraggingId(null); setDragOverTier(null); }}
                              >
                                <button className="tier-card__open" onClick={() => openDetail(item)} aria-label={`Open ${item.title}`}>
                                  <Poster item={item} className="tier-card__poster" />
                                  <span className="tier-card__copy">
                                    <strong title={item.title}>{item.title}</strong>
                                    <small className={`live-summary live-summary--${summary.tone}`}>
                                      {syncing ? <LoaderCircle className="spin" size={11} /> : summary.tone === "live" ? <Radio size={11} /> : null}
                                      {summary.text}
                                    </small>
                                    {item.status !== "finished" && <em>{STATUS_LABELS[item.status]}</em>}
                                  </span>
                                </button>
                                <span className="tier-card__handle" aria-hidden="true">
                                  {savingTier ? <LoaderCircle className="spin" size={13} /> : <GripVertical size={16} />}
                                </span>
                                <label className="tier-card__select">
                                  <span className="sr-only">Move {item.title} to tier</span>
                                  <select value={item.tier} disabled={savingTier} onChange={(event) => void moveToTier(item, event.target.value as MediaTier)}>
                                    {BOARD_TIERS.map((option) => <option key={option} value={option}>{TIER_LABELS[option]}</option>)}
                                  </select>
                                  <ChevronDown size={12} />
                                </label>
                              </article>
                            );
                          })}
                          {!tierItems.length && (
                            <div className="tier-row__empty">
                              <GripVertical size={16} /> Drop a title here
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}

              <footer className="tierlist-note">
                <ShieldCheck size={15} />
                <span>MyAnimeList is the primary anime catalog; AniList adds schedules only when available, while the MAL bridge and Kitsu prevent a total catalog outage. TVmaze supplies TV data. IMDb links and licensed metadata are used only when their connection is configured.</span>
              </footer>
            </section>
          )}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={activeView === "library" && !activeCollectionId && activeType === "all" && activeStatus === "all" ? "active" : ""} onClick={() => selectType("all")} aria-current={activeView === "library" && !activeCollectionId && activeType === "all" && activeStatus === "all" ? "page" : undefined}><LayoutGrid size={19} /><span>Home</span></button>
        <button className={activeView === "library" && activeStatus === "continue" ? "active" : ""} onClick={() => selectStatus("continue")} aria-current={activeView === "library" && activeStatus === "continue" ? "page" : undefined}><Play size={19} /><span>Continue</span></button>
        <button className="mobile-add" onClick={() => openNew()} aria-label="Add media"><Plus size={23} /></button>
        <button className={activeView === "tierlist" ? "active" : ""} onClick={openTierList} aria-current={activeView === "tierlist" ? "page" : undefined}><Trophy size={19} /><span>Tier list</span></button>
        <button onClick={() => setMobileNavOpen(true)}><CircleUserRound size={19} /><span>More</span></button>
      </nav>

      {securityOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSecurityOpen(false)}>
          <section className="security-modal" role="dialog" aria-modal="true" aria-label="Security center" ref={securityDialogRef} tabIndex={-1}>
            <button className="modal-close" onClick={() => setSecurityOpen(false)} aria-label="Close security center"><X size={18} /></button>
            <header className="security-header">
              <span className="security-header__icon"><ShieldCheck size={24} /></span>
              <div>
                <p className="eyebrow">Owner-only controls</p>
                <h2>Security center</h2>
                <p>Live request defenses and database health for your private tracker.</p>
              </div>
              <span className="security-live"><i /> Protected</span>
            </header>

            {securityError && <div className="inline-note inline-note--error security-error" role="alert">{securityError}</div>}

            {securityLoading && !securityMetrics ? (
              <div className="security-loading" aria-label="Checking security status">
                <LoaderCircle className="spin" size={20} /> Verifying controls…
              </div>
            ) : securityMetrics && (
              <div className="security-body">
                <div className="security-metrics">
                  <article>
                    <span><ShieldCheck size={16} /> Blocked requests</span>
                    <strong>{securityMetrics.security.blocked24h}</strong>
                    <small>Last 24 hours</small>
                  </article>
                  <article>
                    <span><Activity size={16} /> Rate limited</span>
                    <strong>{securityMetrics.security.rateLimited24h}</strong>
                    <small>Last 24 hours</small>
                  </article>
                  <article>
                    <span><LockKeyhole size={16} /> Invalid requests</span>
                    <strong>{securityMetrics.security.invalidRequests24h + securityMetrics.security.crossOrigin24h + securityMetrics.security.unauthorized24h}</strong>
                    <small>Rejected before changes</small>
                  </article>
                  <article className="security-metric--database">
                    <span><Database size={16} /> Database</span>
                    <strong>{securityMetrics.database.records}</strong>
                    <small>{securityMetrics.database.status === "healthy" ? "Healthy · query verified" : "Needs attention"}</small>
                  </article>
                </div>

                <div className="security-columns">
                  <section>
                    <div className="security-section-title"><h3>Active defenses</h3><span>Enforced</span></div>
                    <div className="security-controls">
                      <div><ShieldCheck size={17} /><span><strong>Owner-only access</strong><small>The signed-in account must match the configured owner identity.</small></span><i /></div>
                      <div><LockKeyhole size={17} /><span><strong>Protected writes</strong><small>Same-origin checks, JSON validation, and a 64 KB limit.</small></span><i /></div>
                      <div><Activity size={17} /><span><strong>Request throttling</strong><small>Separate limits protect reads, writes, search, metadata sync, and metrics.</small></span><i /></div>
                      <div><Database size={17} /><span><strong>Private audit logs</strong><small>Rejected requests and successful changes are recorded without payloads or raw IPs.</small></span><i /></div>
                    </div>
                  </section>

                  <section>
                    <div className="security-section-title"><h3>Database snapshot</h3><span>{securityMetrics.database.status}</span></div>
                    <dl className="database-snapshot">
                      <div><dt>Total records</dt><dd>{securityMetrics.database.records}</dd></div>
                      <div><dt>In progress</dt><dd>{securityMetrics.database.inProgress}</dd></div>
                      <div><dt>Finished</dt><dd>{securityMetrics.database.finished}</dd></div>
                      <div><dt>Unranked</dt><dd>{securityMetrics.database.unranked}</dd></div>
                      <div><dt>Audited changes · 24h</dt><dd>{securityMetrics.security.auditedChanges24h}</dd></div>
                    </dl>
                    <div className="security-breakdown">
                      <span><em>Unauthorized</em><strong>{securityMetrics.security.unauthorized24h}</strong></span>
                      <span><em>Cross-origin</em><strong>{securityMetrics.security.crossOrigin24h}</strong></span>
                      <span><em>Last blocked event</em><strong>{formatTimestamp(securityMetrics.security.lastEventAt)}</strong></span>
                    </div>
                  </section>
                </div>

                <DataExportActions />

                <footer className="security-footer">
                  <p><LockKeyhole size={14} /> Counters show requests the app rejected; they do not label every event as a confirmed cyberattack.</p>
                  <button className="secondary-button" onClick={() => void loadSecurityMetrics()} disabled={securityLoading}>
                    {securityLoading ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />} Refresh status
                  </button>
                </footer>
              </div>
            )}
          </section>
        </div>
      )}

      {collectionManagerOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeCollectionManager()}>
          <section className="collection-modal" role="dialog" aria-modal="true" aria-labelledby="collection-manager-title" ref={collectionDialogRef} tabIndex={-1}>
            <button className="modal-close" onClick={closeCollectionManager} disabled={collectionSaving} aria-label="Close collection manager"><X size={18} /></button>
            <header className="collection-modal__header">
              <span><FolderPlus size={22} /></span>
              <div>
                <p className="eyebrow">Flexible, without the clutter</p>
                <h2 id="collection-manager-title">Manage collections</h2>
                <p>Create your own shelves and choose how every collection appears in the sidebar.</p>
              </div>
            </header>

            <div className="collection-modal__body">
              <form className="collection-create" onSubmit={(event) => void createCollection(event)}>
                <label>
                  <span className="sr-only">New collection name</span>
                  <Folder size={15} />
                  <input
                    value={newCollectionName}
                    onChange={(event) => setNewCollectionName(event.target.value)}
                    maxLength={60}
                    placeholder="New collection name"
                    autoComplete="off"
                  />
                </label>
                <button className="primary-button" type="submit" disabled={!newCollectionName.trim() || collectionSaving}>
                  {collectionSaving ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create
                </button>
              </form>

              {collectionError && <div className="inline-note inline-note--error collection-error" role="alert">{collectionError}</div>}

              <div className="collection-list" aria-label="Collection order">
                {collections.map((collection, index) => {
                  const Icon = collection.kind === "custom" || !collection.filterKey
                    ? Folder
                    : COLLECTION_ICONS[collection.filterKey];
                  const editing = editingCollectionId === collection.id;
                  const confirmingDelete = confirmingCollectionDeleteId === collection.id;
                  return (
                    <div
                      className={`collection-row ${draggingCollectionId === collection.id ? "collection-row--dragging" : ""} ${dragOverCollectionId === collection.id ? "collection-row--over" : ""}`}
                      key={collection.id}
                      draggable={!collectionSaving && !editing && !confirmingDelete}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", collection.id);
                        setDraggingCollectionId(collection.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverCollectionId(collection.id);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverCollectionId(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        dropCollection(collection.id);
                      }}
                      onDragEnd={() => {
                        setDraggingCollectionId(null);
                        setDragOverCollectionId(null);
                      }}
                    >
                      <span className="collection-row__handle" aria-hidden="true"><GripVertical size={16} /></span>
                      <span className="collection-row__icon"><Icon size={15} /></span>
                      {editing ? (
                        <form className="collection-row__edit" onSubmit={(event) => void saveCollectionRename(event)}>
                          <input
                            value={editingCollectionName}
                            onChange={(event) => setEditingCollectionName(event.target.value)}
                            maxLength={60}
                            aria-label={`Rename ${collection.name}`}
                            autoFocus
                          />
                          <button type="submit" disabled={!editingCollectionName.trim() || collectionSaving} aria-label="Save collection name"><Check size={14} /></button>
                          <button type="button" onClick={() => { setEditingCollectionId(null); setEditingCollectionName(""); }} aria-label="Cancel rename"><X size={14} /></button>
                        </form>
                      ) : (
                        <>
                          <span className="collection-row__copy">
                            <strong>{collection.name}</strong>
                            <small>{collection.kind === "system" ? "Built in" : "Custom"} · {collectionCount(collection)} {collectionCount(collection) === 1 ? "title" : "titles"}</small>
                          </span>
                          {confirmingDelete ? (
                            <span className="collection-row__confirm">
                              <em>Delete?</em>
                              <button type="button" onClick={() => setConfirmingCollectionDeleteId(null)}>Cancel</button>
                              <button className="collection-row__remove" type="button" onClick={() => void deleteCollection(collection.id)}>Remove</button>
                            </span>
                          ) : (
                            <span className="collection-row__actions">
                              <button type="button" onClick={() => moveCollection(collection.id, -1)} disabled={index === 0 || collectionSaving} aria-label={`Move ${collection.name} up`}><ArrowUp size={14} /></button>
                              <button type="button" onClick={() => moveCollection(collection.id, 1)} disabled={index === collections.length - 1 || collectionSaving} aria-label={`Move ${collection.name} down`}><ArrowDown size={14} /></button>
                              {collection.kind === "custom" && (
                                <>
                                  <button type="button" onClick={() => beginCollectionRename(collection)} disabled={collectionSaving} aria-label={`Rename ${collection.name}`}><Pencil size={13} /></button>
                                  <button type="button" onClick={() => { setConfirmingCollectionDeleteId(collection.id); setEditingCollectionId(null); }} disabled={collectionSaving} aria-label={`Delete ${collection.name}`}><Trash2 size={13} /></button>
                                </>
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="collection-modal__hint"><GripVertical size={14} /> Drag to reorder, or use the arrow buttons for touch and keyboard.</p>
            </div>
          </section>
        </div>
      )}

      {detailItem && (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetail()}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-label={`${detailItem.title} details`} ref={detailDialogRef} tabIndex={-1}>
            <button className="modal-close" onClick={closeDetail} aria-label="Close details"><X size={18} /></button>
            <div className={`detail-hero accent-${TYPE_ACCENTS[detailItem.type]}`} style={detailItem.backdropUrl ? { backgroundImage: `linear-gradient(180deg, rgba(10,11,15,.18), rgba(10,11,15,.96)), url(${detailItem.backdropUrl})` } : undefined}>
              <Poster item={detailItem} className="detail-poster" />
              <div className="detail-title">
                <div className="detail-kicker"><span>{TYPE_LABELS[detailItem.type]}</span><span>{STATUS_LABELS[detailItem.status]}</span></div>
                <h2>{detailItem.title}</h2>
                {detailItem.alternateTitle && <p>{detailItem.alternateTitle}</p>}
                <div className="detail-actions">
                  <button className="primary-button" onClick={() => openEdit(detailItem)}><Pencil size={16} /> Edit</button>
                  {supportsMetadataSync(detailItem) && (
                    <button
                      className="secondary-button"
                      onClick={() => void syncSingle(detailItem)}
                      disabled={syncingIds.has(detailItem.id)}
                    >
                      {syncingIds.has(detailItem.id) ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                      {syncingIds.has(detailItem.id) ? "Syncing" : "Sync metadata"}
                    </button>
                  )}
                  {detailItem.externalUrl && <a className="secondary-button" href={detailItem.externalUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Source</a>}
                </div>
              </div>
            </div>
            <div className="detail-body">
              <div className="detail-main">
                <div className="detail-block detail-description">
                  <div className="detail-block__heading">
                    <h3>About</h3>
                    {detailItem.overview && <span>{detailItem.descriptionSource ?? detailItem.provider ?? "Saved description"}</span>}
                  </div>
                  <p>{detailItem.overview || "No description has been synced yet. Refresh metadata to look for one."}</p>
                </div>
                {detailItem.metadataLastErrorCode && (
                  <div className="metadata-sync-alert" role="status">
                    <Database size={14} />
                    <span>
                      <strong>Last metadata refresh was deferred</strong>
                      <small>
                        {detailItem.metadataLastErrorProvider
                          ? `${detailItem.metadataLastErrorProvider} could not complete the request.`
                          : "A metadata provider could not complete the request."}
                        {detailItem.metadataRetryAfterAt
                          ? ` Automatic retries resume after ${formatTimestamp(detailItem.metadataRetryAfterAt)}.`
                          : " Your saved details were not changed."}
                      </small>
                    </span>
                  </div>
                )}
                {supportsSeriesSchedule(detailItem) && (
                  <div className="detail-block live-data-block">
                    <div className="detail-block__heading">
                      <h3><Radio size={15} /> Live series data</h3>
                      <span className={detailItem.airingStatus === "releasing" ? "live-data-badge live-data-badge--airing" : "live-data-badge"}>
                        {detailItem.airingStatus ? AIRING_STATUS_LABELS[detailItem.airingStatus] : "Not synced"}
                      </span>
                    </div>
                    <div className="live-data-grid">
                      <div><span>Released seasons</span><strong>{detailItem.releasedSeasonCount ?? "—"}</strong></div>
                      <div><span>Confirmed seasons</span><strong>{detailItem.seasonCount ?? "—"}</strong></div>
                      <div><span>You completed</span><strong>{detailItem.completedSeasons ?? "Not set"}</strong></div>
                      <div><span>Released episodes</span><strong>{detailItem.availableUnits ?? "—"}</strong></div>
                      {detailMovieCounts && detailMovieCounts.confirmed > 0 && <>
                        <div><span>Related movies</span><strong>{detailMovieCounts.released} released · {detailMovieCounts.confirmed} confirmed</strong></div>
                        <div><span>Movies completed</span><strong>{detailItem.completedMovies ?? "Not set"}</strong></div>
                      </>}
                      <div className="live-data-grid__wide">
                        <span>What’s next</span>
                        <strong>{detailContinuation && detailContinuation.reason !== "in_progress"
                          ? `${detailContinuation.label}${detailContinuation.title ? ` · ${detailContinuation.title}` : ""}`
                          : detailItem.nextAiringLabel
                            ? `${detailItem.nextAiringLabel} · ${relativeAiringTime(detailItem.nextAiringAt) ?? "time not listed"}`
                            : "No continuation detected"}</strong>
                      </div>
                    </div>
                    {detailItem.scheduleAlert && <div className="schedule-alert"><Bell size={14} /> {detailItem.scheduleAlert}</div>}
                    <p className="live-data-source">
                      {detailItem.provider ? `Source: ${detailItem.provider}` : "Open or sync this title to find live data."}
                      {detailItem.metadataUpdatedAt ? ` · Updated ${formatTimestamp(detailItem.metadataUpdatedAt)}` : ""}
                    </p>
                  </div>
                )}
                {detailItem.metadataSources.length > 0 && (
                  <div className="detail-block metadata-provenance">
                    <div className="detail-block__heading"><h3><Database size={14} /> Metadata provenance</h3><span>{detailItem.metadataSources.length} sources</span></div>
                    <div className="metadata-source-list">
                      {detailItem.metadataSources.map((source) => source.url ? (
                        <a key={`${source.name}-${source.role}`} href={source.url} target="_blank" rel="noreferrer">
                          <span>{source.name}</span><small>{SOURCE_ROLE_LABELS[source.role]}</small><ExternalLink size={12} />
                        </a>
                      ) : (
                        <span key={`${source.name}-${source.role}`}>
                          <span>{source.name}</span><small>{SOURCE_ROLE_LABELS[source.role]}</small>
                        </span>
                      ))}
                    </div>
                    {metadataProvidersLoaded && detailItem.imdbId && !imdbConnected && (
                      <p className="imdb-connection-note">IMDb title {detailItem.imdbId} is matched. IMDb descriptions and ratings require the licensed API connection; this app does not scrape IMDb pages.</p>
                    )}
                  </div>
                )}
                <div className="detail-block progress-block">
                  <div className="detail-block__heading"><h3>Progress</h3><span>{progressPercent(detailItem)}%</span></div>
                  <ProgressBar item={detailItem} />
                  <div className="progress-actions">
                    <button onClick={() => void incrementProgress(detailItem, -1)} disabled={detailItem.progress <= 0}><Minus size={16} /> Undo one</button>
                    <button onClick={() => void incrementProgress(detailItem, 1)}><Plus size={16} /> Add one</button>
                    {detailItem.status !== "finished" && (
                      <button onClick={() => void ((detailItem.type === "anime" || detailItem.type === "tv")
                        ? markCaughtUp(detailItem)
                        : updateItem(detailItem, { status: "finished", progress: detailItem.totalUnits ?? detailItem.progress }))}>
                        <Check size={16} /> {detailItem.type === "anime" || detailItem.type === "tv" ? "Mark caught up" : "Mark finished"}
                      </button>
                    )}
                    {detailItem.status === "finished" && detailContinuation?.reason === "available" && (
                      <button onClick={() => void markCaughtUp(detailItem)}><Check size={16} /> Mark new content watched</button>
                    )}
                  </div>
                </div>
                {detailItem.review && <div className="detail-block"><h3>Your review</h3><p className="review-copy">{detailItem.review}</p></div>}
                {detailItem.notes && <div className="detail-block private-note"><h3>Private notes</h3><p>{detailItem.notes}</p></div>}
              </div>
              <aside className="detail-aside">
                <div className="detail-facts">
                  <div><span>Your rating</span><strong>{detailItem.rating !== null ? <><Star size={14} fill="currentColor" /> {detailItem.rating.toFixed(1)} / 10</> : "Not rated"}</strong></div>
                  {detailItem.communityRating !== null && (
                    <div><span>{detailItem.ratingSource ?? "Community"} rating</span><strong><Star size={14} fill="currentColor" /> {detailItem.communityRating.toFixed(1)} / 10{formatVotes(detailItem.ratingVotes) ? ` · ${formatVotes(detailItem.ratingVotes)} votes` : ""}</strong></div>
                  )}
                  <div><span>Tier</span><strong className={`tier-value tier-value--${detailItem.tier}`}>{TIER_LABELS[detailItem.tier]}</strong></div>
                  <div><span>Priority</span><strong>{PRIORITY_LABELS[detailItem.priority]}</strong></div>
                  <div><span>Release date</span><strong>{formatDate(detailItem.releaseDate) ?? "Not set"}</strong></div>
                  <div><span>Reminder</span><strong>{formatDate(detailItem.reminderDate) ?? "Not set"}</strong></div>
                  <div><span>Added to library</span><strong>{formatLibraryTimestamp(detailItem.createdAt)}</strong></div>
                  <div><span>Last modified</span><strong>{formatLibraryTimestamp(detailItem.updatedAt)}</strong></div>
                </div>
                <div className="detail-collections">
                  <div className="detail-collections__heading">
                    <span><Folder size={14} /> Collections</span>
                    <button
                      type="button"
                      onClick={() => { closeDetail(); openCollectionManager(); }}
                      aria-label="Manage collections"
                      title="Manage collections"
                    ><Settings2 size={13} /></button>
                  </div>
                  {customCollections.length ? (
                    <div className="collection-membership-list">
                      {customCollections.map((collection) => {
                        const selected = collection.mediaItemIds.includes(detailItem.id);
                        return (
                          <button
                            type="button"
                            key={collection.id}
                            className={selected ? "active" : ""}
                            onClick={() => void toggleItemCollection(detailItem, collection.id)}
                            disabled={membershipSavingIds.has(detailItem.id)}
                            aria-pressed={selected}
                          >
                            <span>{selected ? <Check size={12} /> : <Folder size={12} />}{collection.name}</span>
                            {membershipSavingIds.has(detailItem.id) && <LoaderCircle className="spin" size={12} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button className="detail-collections__empty" type="button" onClick={() => { closeDetail(); openCollectionManager(); }}>
                      <Plus size={13} /> Create your first collection
                    </button>
                  )}
                </div>
                {(detailItem.genres.length > 0 || detailItem.tags.length > 0) && (
                  <div className="detail-tags">
                    {[...detailItem.genres, ...detailItem.tags].map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
                {confirmingDeleteId === detailItem.id ? (
                  <div className="delete-confirm" role="alert">
                    <strong>Remove this title?</strong>
                    <span>This cannot be undone.</span>
                    <div>
                      <button onClick={() => setConfirmingDeleteId(null)}>Cancel</button>
                      <button onClick={() => void removeItem(detailItem)}><Trash2 size={13} /> Remove</button>
                    </div>
                  </div>
                ) : (
                  <button className="danger-button" onClick={() => setConfirmingDeleteId(detailItem.id)}><Trash2 size={15} /> Remove from library</button>
                )}
              </aside>
            </div>
          </section>
        </div>
      )}

      {formOpen && (
        <div className="modal-layer modal-layer--drawer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeForm()}>
          <section className="form-drawer" role="dialog" aria-modal="true" aria-label={editingId ? "Edit media" : "Add media"} ref={formDialogRef} tabIndex={-1}>
            <div className="drawer-header">
              <div><p className="eyebrow">{editingId ? "Update your library" : "Build your library"}</p><h2>{editingId ? "Edit media" : "Add something new"}</h2></div>
              <button className="modal-close modal-close--inline" onClick={closeForm} aria-label="Close form"><X size={18} /></button>
            </div>
            <form onSubmit={saveForm}>
              <div className="drawer-scroll">
                <fieldset className="type-selector">
                  <legend>Media type</legend>
                  <div>{MEDIA_TYPES.map((type) => {
                    const Icon = TYPE_ICONS[type];
                    return <button type="button" key={type} className={form.type === type ? "active" : ""} onClick={() => changeFormType(type)}><Icon size={16} />{TYPE_LABELS[type]}</button>;
                  })}</div>
                </fieldset>

                <div className="metadata-search">
                    <label htmlFor="metadata-query"><span><Sparkles size={15} /> {editingId ? "Refresh posters & details" : "Find posters & details"}</span></label>
                    <div className="metadata-search__input"><Search size={17} /><input id="metadata-query" value={discoverQuery} onChange={(event) => setDiscoverQuery(event.target.value)} placeholder={`Search for ${form.type === "tv" ? "a TV series" : `a ${form.type}`}`} />{discovering && <LoaderCircle className="spin" size={17} />}</div>
                    <p>Choose a match to fill the form automatically, or keep the details already entered below.</p>
                    {discoveryError && <div className="inline-note inline-note--warning">{discoveryError} You can still add this title manually.</div>}
                    {discoverQuery.trim().length >= 2 && discoveryResults.length > 0 && (
                      <div className="discovery-results">
                        {discoveryResults.map((result) => (
                          <button type="button" key={result.key} onClick={() => applyDiscovery(result)}>
                            <Poster item={result} />
                            <span><strong>{result.title}</strong><small>{result.meta || result.provider}</small></span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                <div className="form-section">
                  <div className="form-section__title"><span>Core details</span><small>Required</small></div>
                  <div className="field-grid field-grid--three">
                    <label className="field field--wide"><span>Title</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Media title" required /></label>
                    <label className="field"><span>Status</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as MediaStatus })}>{MEDIA_STATUSES.map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label>
                    <label className="field"><span>Priority</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as MediaPriority })}>{MEDIA_PRIORITIES.map((priority) => <option value={priority} key={priority}>{PRIORITY_LABELS[priority]}</option>)}</select></label>
                    <label className="field"><span>Tier</span><select value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value as MediaTier })}>{MEDIA_TIERS.map((tier) => <option value={tier} key={tier}>{TIER_LABELS[tier]}</option>)}</select></label>
                  </div>
                </div>

                <div className="form-section">
                  <div className="form-section__title"><span>Progress</span><small>Track as you go</small></div>
                  <div className="field-grid field-grid--three">
                    <label className="field"><span>Current</span><input type="number" min="0" value={form.progress} onChange={(event) => setForm({ ...form, progress: event.target.value })} /></label>
                    <label className="field"><span>Total</span><input type="number" min="0" value={form.totalUnits} onChange={(event) => setForm({ ...form, totalUnits: event.target.value })} placeholder="Unknown" /></label>
                    <label className="field"><span>Unit</span><input value={form.unitLabel} onChange={(event) => setForm({ ...form, unitLabel: event.target.value })} placeholder="episodes" /></label>
                  </div>
                  {(form.type === "anime" || form.type === "tv") && (
                    <div className="field-grid series-progress-fields">
                      <label className="field"><span>Seasons completed</span><input type="number" min="0" value={form.completedSeasons} onChange={(event) => setForm({ ...form, completedSeasons: event.target.value })} placeholder="Auto-detect" /></label>
                      {form.type === "anime" && <label className="field"><span>Related movies completed</span><input type="number" min="0" value={form.completedMovies} onChange={(event) => setForm({ ...form, completedMovies: event.target.value })} placeholder="Auto-detect" /></label>}
                    </div>
                  )}
                </div>

                <div className="form-section">
                  <div className="form-section__title"><span>Your take</span><small>Private to you</small></div>
                  <div className="field-grid">
                    <label className="field"><span>Rating <em>{form.rating ? `${form.rating}/10` : "Not rated"}</em></span><input className="range" type="range" min="0" max="10" step="0.5" value={form.rating || "0"} onChange={(event) => setForm({ ...form, rating: event.target.value === "0" ? "" : event.target.value })} /></label>
                    <label className="field"><span><Tag size={13} /> Tags</span><input value={form.tagsText} onChange={(event) => setForm({ ...form, tagsText: event.target.value })} placeholder="comfort, backlog, favorite" /></label>
                    <label className="field field--wide"><span>Review</span><textarea rows={3} value={form.review} onChange={(event) => setForm({ ...form, review: event.target.value })} placeholder="Your considered thoughts after watching, reading, or playing…" /></label>
                    <label className="field field--wide"><span>Private notes</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Anything you want to remember—where you stopped, characters, theories…" /></label>
                  </div>
                </div>

                <div className="form-section">
                  <div className="form-section__title"><span>Dates & reminders</span><small>Stay ahead</small></div>
                  <div className="field-grid">
                    <label className="field"><span>Release date</span><input type="date" value={form.releaseDate} onInput={(event) => setForm({ ...form, releaseDate: event.currentTarget.value })} /></label>
                    <label className="field"><span>Remind me on</span><input type="date" value={form.reminderDate} onInput={(event) => setForm({ ...form, reminderDate: event.currentTarget.value })} /></label>
                  </div>
                </div>

                <details className="advanced-fields">
                  <summary><span>More information</span><ChevronDown size={16} /></summary>
                  <div className="field-grid">
                    <label className="field field--wide"><span>Alternate title</span><input value={form.alternateTitle} onChange={(event) => setForm({ ...form, alternateTitle: event.target.value })} /></label>
                    <label className="field field--wide"><span>Overview</span><textarea rows={4} value={form.overview} onChange={(event) => setForm({ ...form, overview: event.target.value })} /></label>
                    <label className="field field--wide"><span>Poster URL</span><input type="url" value={form.posterUrl} onChange={(event) => setForm({ ...form, posterUrl: event.target.value })} placeholder="https://…" /></label>
                  </div>
                </details>
                {formError && <div className="inline-note inline-note--error" role="alert">{formError}</div>}
              </div>
              <div className="drawer-footer">
                <button type="button" className="secondary-button" onClick={closeForm}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? <><LoaderCircle className="spin" size={17} /> Saving</> : <><Check size={17} /> {editingId ? "Save changes" : "Add to library"}</>}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
