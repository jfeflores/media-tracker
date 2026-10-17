import type { MetadataProviderId } from "@/app/lib/provider-health";

export type MetadataFailureCode =
  | "circuit_open"
  | "forbidden"
  | "invalid_response"
  | "network_error"
  | "not_configured"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "unauthorized"
  | "upstream_unavailable"
  | "unknown";

export type MetadataProviderFailure = {
  provider: MetadataProviderId;
  code: MetadataFailureCode;
  status: number | null;
  retryable: boolean;
  retryAfterAt: string | null;
};

type FetchOptions = {
  attempts?: number;
  timeoutMs?: number;
};

const localCircuit = new Map<MetadataProviderId, number>();
const persistedCircuit = new Map<MetadataProviderId, { checkedAt: number; retryAfter: number }>();

const PROVIDER_HOSTS: Partial<Record<MetadataProviderId, readonly string[]>> = {
  anilist: ["graphql.anilist.co"],
  myanimelist: ["api.myanimelist.net"],
  jikan: ["api.jikan.moe"],
  kitsu: ["kitsu.io", "kitsu.app"],
  tvmaze: ["api.tvmaze.com"],
  wikipedia: ["en.wikipedia.org"],
  wikidata: ["www.wikidata.org"],
};

export class MetadataProviderError extends Error {
  readonly failure: MetadataProviderFailure;

  constructor(failure: MetadataProviderFailure, message?: string) {
    super(message ?? `${failure.provider} metadata request failed (${failure.code}).`);
    this.name = "MetadataProviderError";
    this.failure = failure;
  }
}

export class MetadataProviderAggregateError extends Error {
  readonly failures: MetadataProviderFailure[];

  constructor(failures: MetadataProviderFailure[]) {
    super("Every configured MyAnimeList catalog path failed.");
    this.name = "MetadataProviderAggregateError";
    this.failures = failures;
  }
}

export class MetadataSyncError extends Error {
  readonly code: "provider_unavailable" | "not_found";
  readonly failures: MetadataProviderFailure[];
  readonly retryAfterAt: string | null;
  readonly publicMessage: string;

  constructor(failures: MetadataProviderFailure[]) {
    const retryAfterAt = latestRetryAfter(failures);
    const providerFailure = failures.some((failure) => failure.code !== "not_found");
    const publicMessage = providerFailure
      ? "Anime and manga metadata providers are temporarily unavailable. Your saved entry was left unchanged."
      : "No reliable catalog match was found. Try choosing a result from Add media first.";
    super(publicMessage);
    this.name = "MetadataSyncError";
    this.code = providerFailure ? "provider_unavailable" : "not_found";
    this.failures = uniqueFailures(failures);
    this.retryAfterAt = retryAfterAt;
    this.publicMessage = publicMessage;
  }
}

export async function fetchProviderJson<T>(
  provider: MetadataProviderId,
  url: string,
  init?: RequestInit,
  options: FetchOptions = {},
): Promise<T> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || target.port
    || !PROVIDER_HOSTS[provider]?.includes(target.hostname)) {
    throw new MetadataProviderError(createFailure(provider, "invalid_response", null, false, 0));
  }
  await assertCircuitClosed(provider);
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2));
  let lastFailure: MetadataProviderFailure | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      // Workers supports manual/follow. Reject 3xx through the normal status
      // path instead of using the unsupported redirect: error mode.
      const response = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
      if (!response.ok) {
        lastFailure = failureFromStatus(provider, response.status, response.headers.get("retry-after"));
        if (lastFailure.retryable && lastFailure.status !== 429 && attempt < attempts) {
          await shortBackoff(attempt, lastFailure.retryAfterAt);
          continue;
        }
        await openProviderCircuit(lastFailure);
        throw new MetadataProviderError(lastFailure);
      }

      let data: T;
      try {
        data = await response.json() as T;
      } catch {
        lastFailure = createFailure(provider, "invalid_response", null, false, 5 * 60);
        await openProviderCircuit(lastFailure);
        throw new MetadataProviderError(lastFailure);
      }
      localCircuit.delete(provider);
      // A successful upstream response is stronger evidence than another D1
      // circuit lookup. Reuse that closed-state result for the existing 15s
      // circuit-cache window during batch refreshes.
      persistedCircuit.set(provider, { checkedAt: Date.now(), retryAfter: 0 });
      await markProviderSuccess(provider);
      return data;
    } catch (error) {
      if (error instanceof MetadataProviderError) throw error;
      lastFailure = error instanceof Error && error.name === "AbortError"
        ? createFailure(provider, "timeout", null, true, 60)
        : createFailure(provider, "network_error", null, true, 60);
      if (attempt < attempts) {
        await shortBackoff(attempt, null);
        continue;
      }
      await openProviderCircuit(lastFailure);
      throw new MetadataProviderError(lastFailure);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new MetadataProviderError(lastFailure ?? createFailure(provider, "unknown", null, false, 60));
}

export function providerFailuresFrom(error: unknown, fallback: MetadataProviderId) {
  if (error instanceof MetadataProviderAggregateError) return error.failures;
  if (error instanceof MetadataProviderError) return [error.failure];
  return [createFailure(fallback, "unknown", null, false, 60)];
}

export async function recordInvalidProviderResponse(
  provider: MetadataProviderId,
  code: MetadataFailureCode = "invalid_response",
) {
  const failure = createFailure(provider, code, null, false, 5 * 60);
  await openProviderCircuit(failure);
  return failure;
}

export function notFoundFailure(provider: MetadataProviderId): MetadataProviderFailure {
  return {
    provider,
    code: "not_found",
    status: null,
    retryable: false,
    retryAfterAt: null,
  };
}

export function __resetMetadataProviderStateForTests() {
  localCircuit.clear();
  persistedCircuit.clear();
}

async function assertCircuitClosed(provider: MetadataProviderId) {
  const now = Date.now();
  const localRetry = localCircuit.get(provider) ?? 0;
  if (localRetry > now) {
    throw new MetadataProviderError(circuitFailure(provider, localRetry));
  }
  if (localRetry) localCircuit.delete(provider);

  const cached = persistedCircuit.get(provider);
  if (cached && now - cached.checkedAt < 15_000) {
    if (cached.retryAfter > now) throw new MetadataProviderError(circuitFailure(provider, cached.retryAfter));
    return;
  }
  const persisted = await readProviderRetryAfter(provider);
  const retryAfter = persisted ? Date.parse(persisted) : 0;
  persistedCircuit.set(provider, { checkedAt: now, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 });
  if (Number.isFinite(retryAfter) && retryAfter > now) {
    localCircuit.set(provider, retryAfter);
    throw new MetadataProviderError(circuitFailure(provider, retryAfter));
  }
}

async function openProviderCircuit(failure: MetadataProviderFailure) {
  const retryAfter = failure.retryAfterAt ? Date.parse(failure.retryAfterAt) : 0;
  if (Number.isFinite(retryAfter) && retryAfter > Date.now()) {
    localCircuit.set(failure.provider, retryAfter);
    persistedCircuit.set(failure.provider, { checkedAt: Date.now(), retryAfter });
  }
  await markProviderFailure(failure.provider, {
    code: failure.code,
    status: failure.status,
    retryAfterAt: failure.retryAfterAt,
    unavailable: ["circuit_open", "forbidden", "unauthorized", "upstream_unavailable"].includes(failure.code),
  });
}

async function readProviderRetryAfter(provider: MetadataProviderId) {
  try {
    const { getProviderRetryAfter } = await import("@/app/lib/provider-health");
    return await getProviderRetryAfter(provider);
  } catch {
    return null;
  }
}

async function markProviderSuccess(provider: MetadataProviderId) {
  try {
    const { recordProviderSuccess } = await import("@/app/lib/provider-health");
    await recordProviderSuccess(provider);
  } catch {
    // Provider health persistence is best-effort in isolated unit tests.
  }
}

async function markProviderFailure(
  provider: MetadataProviderId,
  details: {
    code: string;
    status?: number | null;
    retryAfterAt?: string | null;
    unavailable?: boolean;
  },
) {
  try {
    const { recordProviderFailure } = await import("@/app/lib/provider-health");
    await recordProviderFailure(provider, details);
  } catch {
    // Provider health persistence is best-effort in isolated unit tests.
  }
}

function failureFromStatus(
  provider: MetadataProviderId,
  status: number,
  retryAfterHeader: string | null,
) {
  if (status === 401) return createFailure(provider, "unauthorized", status, false, 15 * 60);
  if (status === 403) return createFailure(provider, "forbidden", status, false, 15 * 60);
  if (status === 404) return createFailure(provider, "not_found", status, false, 0);
  if (status === 429) {
    const retrySeconds = retryAfterSeconds(retryAfterHeader) ?? 90;
    return createFailure(provider, "rate_limited", status, true, retrySeconds);
  }
  if (status >= 500) return createFailure(provider, "upstream_unavailable", status, true, 2 * 60);
  return createFailure(provider, "invalid_response", status, false, 5 * 60);
}

function createFailure(
  provider: MetadataProviderId,
  code: MetadataFailureCode,
  status: number | null,
  retryable: boolean,
  retrySeconds: number,
): MetadataProviderFailure {
  return {
    provider,
    code,
    status,
    retryable,
    retryAfterAt: retrySeconds > 0
      ? new Date(Date.now() + retrySeconds * 1_000).toISOString()
      : null,
  };
}

function circuitFailure(provider: MetadataProviderId, retryAt: number): MetadataProviderFailure {
  return {
    provider,
    code: "circuit_open",
    status: null,
    retryable: true,
    retryAfterAt: new Date(retryAt).toISOString(),
  };
}

async function shortBackoff(attempt: number, retryAfterAt: string | null) {
  const serverDelay = retryAfterAt ? Date.parse(retryAfterAt) - Date.now() : 0;
  const delay = Math.min(1_500, Math.max(serverDelay, 200 * attempt + Math.floor(Math.random() * 120)));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function retryAfterSeconds(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 15 * 60);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(15 * 60, Math.max(0, Math.ceil((date - Date.now()) / 1_000)));
}

function latestRetryAfter(failures: MetadataProviderFailure[]) {
  const values = failures
    .map((failure) => failure.retryAfterAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return values.at(-1) ?? null;
}

function uniqueFailures(failures: MetadataProviderFailure[]) {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.provider}:${failure.code}:${failure.status ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
