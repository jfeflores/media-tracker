import type { AiringStatus, MediaInstallment, MediaItem, MediaType } from "./media.ts";

type CompletionScopeInput = {
  type: MediaType;
  status: string;
  notes: string | null;
  completedSeasons: number | null;
  completedMovies: number | null;
  releasedSeasonCount: number | null;
  releasedMovieCount: number;
};

export type ContinuationInfo = {
  reason: "in_progress" | "available" | "announced" | "scheduled_episode";
  label: string;
  detail: string;
  title: string | null;
  date: string | null;
};

type ContinuationItem = Pick<MediaItem,
  | "type"
  | "status"
  | "progress"
  | "totalUnits"
  | "unitLabel"
  | "completedSeasons"
  | "completedMovies"
  | "seasonCount"
  | "releasedSeasonCount"
  | "franchiseInstallments"
  | "airingStatus"
  | "nextAiringAt"
  | "nextAiringLabel"
>;

export function inferCompletedScope(input: CompletionScopeInput) {
  if (input.type !== "anime" && input.type !== "tv") {
    return { completedSeasons: input.completedSeasons, completedMovies: input.completedMovies };
  }

  const historyScope = input.notes?.match(/what you watched:\s*(.+)$/i)?.[1]?.trim() ?? null;
  const parsedSeasons = historyScope ? completedSeasonCount(historyScope, input.status) : null;
  const parsedMovies = historyScope
    ? completedMovieCount(historyScope, input.releasedMovieCount)
    : null;

  const completedSeasons = input.completedSeasons ?? parsedSeasons ?? (
    input.status === "finished" && !historyScope && (input.releasedSeasonCount ?? 0) > 0
      ? input.releasedSeasonCount
      : null
  );
  const completedMovies = input.completedMovies ?? parsedMovies ?? (
    input.status === "finished" && !historyScope && input.releasedMovieCount > 0
      ? input.releasedMovieCount
      : null
  );

  return { completedSeasons, completedMovies };
}

export function continuationForItem(item: ContinuationItem): ContinuationInfo | null {
  if (item.status === "in_progress") {
    const total = item.totalUnits === null ? "" : ` of ${item.totalUnits}`;
    return {
      reason: "in_progress",
      label: item.type === "manga" ? "Continue reading" : item.type === "game" ? "Continue playing" : "Continue watching",
      detail: `${item.progress}${total} ${item.unitLabel}`,
      title: null,
      date: null,
    };
  }
  if (item.status !== "finished" || (item.type !== "anime" && item.type !== "tv")) return null;

  const installments = [...item.franchiseInstallments].sort(compareInstallments);
  const seasons = installments.filter((installment) => installment.kind === "season");
  const movies = installments.filter((installment) => installment.kind === "movie");
  const completedSeasons = item.completedSeasons;
  const completedMovies = item.completedMovies ?? 0;

  if (completedSeasons !== null) {
    const nextSeason = firstBeyondCompleted(seasons, completedSeasons);
    if (nextSeason) return installmentContinuation(nextSeason);
    if ((item.seasonCount ?? 0) > completedSeasons) {
      const available = (item.releasedSeasonCount ?? 0) > completedSeasons;
      return {
        reason: available ? "available" : "announced",
        label: available ? "New season available" : "Next season confirmed",
        detail: available
          ? `Season ${completedSeasons + 1} is ready to watch`
          : `Season ${completedSeasons + 1} has been confirmed`,
        title: `Season ${completedSeasons + 1}`,
        date: null,
      };
    }
  }

  const nextMovie = firstBeyondCompleted(movies, completedMovies);
  if (nextMovie) return installmentContinuation(nextMovie);

  if (item.airingStatus === "releasing" && item.nextAiringAt) {
    return {
      reason: "scheduled_episode",
      label: "New episode scheduled",
      detail: item.nextAiringLabel ?? "The next episode has a confirmed date",
      title: item.nextAiringLabel,
      date: item.nextAiringAt,
    };
  }
  return null;
}

export function releasedInstallmentCount(installments: MediaInstallment[], kind: MediaInstallment["kind"]) {
  return installments.filter((installment) => installment.kind === kind && isReleased(installment)).length;
}

function completedSeasonCount(scope: string, status: string) {
  const seasonNumbers = [
    ...scope.matchAll(/\bS(?:eason)?\s*(\d{1,2})\b/gi),
    ...scope.matchAll(/\bSeason\s+(\d{1,2})\b/gi),
  ].map((match) => Number(match[1])).filter(Number.isFinite);
  const partial = scope.match(/\bS(?:eason)?\s*(\d{1,2})\s+(?:partially|in progress)/i)
    ?? scope.match(/\bSeason\s+(\d{1,2})\s+(?:partially|in progress)/i);
  if (partial) return Math.max(0, Number(partial[1]) - 1);
  if (seasonNumbers.length) return Math.max(...seasonNumbers);
  if (status !== "finished") return null;
  if (/\b(movie|film)s?\b/i.test(scope) && !/\b(series|anime|season|as listed)\b/i.test(scope)) return null;
  return 1;
}

function completedMovieCount(scope: string, releasedMovies: number) {
  const numbered = scope.match(/\b(\d+)\s+(?:movies|films)\b/i);
  if (numbered) return Number(numbered[1]);
  if (/\b(movies|films)\b/i.test(scope)) return Math.max(1, releasedMovies);
  return /\b(movie|film)\b/i.test(scope) ? 1 : 0;
}

function firstBeyondCompleted(installments: MediaInstallment[], completed: number) {
  return installments.find((installment, index) => {
    if (installment.kind === "season" && installment.seasonNumber !== null) {
      return installment.seasonNumber > completed;
    }
    return index >= completed;
  }) ?? null;
}

function installmentContinuation(installment: MediaInstallment): ContinuationInfo {
  const available = isReleased(installment);
  const noun = installment.kind === "movie" ? "movie" : "season";
  return {
    reason: available ? "available" : "announced",
    label: available ? `New ${noun} available` : `Next ${noun} confirmed`,
    detail: available ? `${installment.title} is ready to watch` : releaseDetail(installment),
    title: installment.title,
    date: installment.releaseDate,
  };
}

function releaseDetail(installment: MediaInstallment) {
  if (installment.releaseDate) return `${installment.title} begins ${installment.releaseDate}`;
  return `${installment.title} has been announced`;
}

function isReleased(installment: Pick<MediaInstallment, "status" | "releaseDate">) {
  if (installment.status === "finished" || installment.status === "releasing") return true;
  if (!installment.releaseDate) return false;
  const date = Date.parse(`${installment.releaseDate.slice(0, 10)}T23:59:59Z`);
  return Number.isFinite(date) && date <= Date.now();
}

function compareInstallments(left: MediaInstallment, right: MediaInstallment) {
  if (left.kind !== right.kind) return left.kind === "season" ? -1 : 1;
  if (left.seasonNumber !== null || right.seasonNumber !== null) {
    return (left.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (right.seasonNumber ?? Number.MAX_SAFE_INTEGER);
  }
  return (left.releaseDate ?? "9999").localeCompare(right.releaseDate ?? "9999")
    || left.title.localeCompare(right.title);
}

export function installmentStatus(value: string | null | undefined): AiringStatus {
  if (value === "current" || value === "releasing") return "releasing";
  if (value === "finished") return "finished";
  if (["tba", "unreleased", "upcoming", "not_yet_released"].includes(value ?? "")) return "not_yet_released";
  if (value === "cancelled") return "cancelled";
  if (value === "hiatus") return "hiatus";
  return "unknown";
}
