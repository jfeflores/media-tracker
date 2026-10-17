import { DataExchangeClient, SendApiAssetCommand } from "@aws-sdk/client-dataexchange";

export type ImdbMetadata = {
  id: string;
  title: string | null;
  originalTitle: string | null;
  description: string | null;
  communityRating: number | null;
  ratingVotes: number | null;
  genres: string[];
  releaseDate: string | null;
  runtimeMinutes: number | null;
  externalUrl: string;
};

type ImdbConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  dataSetId: string;
  revisionId: string;
  assetId: string;
  apiKey: string;
};

type ImdbTitleResponse = {
  data?: {
    title?: {
      titleText?: { text?: string | null } | null;
      originalTitleText?: { text?: string | null } | null;
      ratingsSummary?: { aggregateRating?: number | null; voteCount?: number | null } | null;
      titleGenres?: { genres?: Array<{ genre?: { text?: string | null } | null }> | null } | null;
      plots?: { edges?: Array<{ node?: { plotText?: { plainText?: string | null } | null } | null }> | null } | null;
      runtime?: { seconds?: number | null } | null;
      releaseDate?: { day?: number | null; month?: number | null; year?: number | null } | null;
    } | null;
  };
  errors?: Array<{ message?: string | null }>;
};

type DateParts = { day?: number | null; month?: number | null; year?: number | null } | null | undefined;

const IMDB_TITLE_QUERY = `
  query MediaTrackerTitle($id: ID!) {
    title(id: $id) {
      titleText { text }
      originalTitleText { text }
      ratingsSummary { aggregateRating voteCount }
      titleGenres { genres { genre { text } } }
      plots(first: 1) { edges { node { plotText { plainText } } } }
      runtime { seconds }
      releaseDate { day month year }
    }
  }
`;

export async function isImdbConfigured() {
  return Boolean(await getImdbConfig());
}

export async function getImdbMetadata(imdbId: string): Promise<ImdbMetadata | null> {
  if (!/^tt\d{5,12}$/.test(imdbId)) return null;
  const config = await getImdbConfig();
  if (!config) return null;

  const client = new DataExchangeClient({
    region: "us-east-1",
    maxAttempts: 2,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await client.send(new SendApiAssetCommand({
      AssetId: config.assetId,
      Body: JSON.stringify({ query: IMDB_TITLE_QUERY, variables: { id: imdbId } }),
      DataSetId: config.dataSetId,
      Method: "POST",
      Path: "/v1",
      RevisionId: config.revisionId,
      RequestHeaders: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
    }), { abortSignal: controller.signal });
    const rawBody = response.Body;
    if (!rawBody) throw new Error("IMDb returned an empty response.");
    const body = JSON.parse(typeof rawBody === "string"
      ? rawBody
      : new TextDecoder().decode(rawBody as unknown as Uint8Array)) as ImdbTitleResponse;
    const title = body.data?.title;
    if (!title) {
      if (body.errors?.length) throw new Error("IMDb returned a GraphQL error.");
      return null;
    }
    const seconds = title.runtime?.seconds;
    const metadata = {
      id: imdbId,
      title: cleanText(title.titleText?.text, 300),
      originalTitle: cleanText(title.originalTitleText?.text, 300),
      description: cleanText(title.plots?.edges?.[0]?.node?.plotText?.plainText, 1_500),
      communityRating: validRating(title.ratingsSummary?.aggregateRating),
      ratingVotes: validCount(title.ratingsSummary?.voteCount),
      genres: uniqueStrings(title.titleGenres?.genres?.map((entry) => entry.genre?.text) ?? []),
      releaseDate: dateFromParts(title.releaseDate),
      runtimeMinutes: typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
        ? Math.round(seconds / 60)
        : null,
      externalUrl: `https://www.imdb.com/title/${imdbId}/`,
    };
    await markImdbSuccess();
    return metadata;
  } catch {
    // Keep AWS credentials and signed request details out of route logs.
    await markImdbFailure({
      code: "upstream_unavailable",
      retryAfterAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      unavailable: true,
    });
    throw new Error("IMDb licensed metadata could not be refreshed.");
  } finally {
    clearTimeout(timer);
    client.destroy();
  }
}

async function markImdbSuccess() {
  try {
    const { recordProviderSuccess } = await import("@/app/lib/provider-health");
    await recordProviderSuccess("imdb");
  } catch {
    // Health persistence is unavailable in isolated adapter tests.
  }
}

async function markImdbFailure(details: {
  code: string;
  retryAfterAt: string;
  unavailable: boolean;
}) {
  try {
    const { recordProviderFailure } = await import("@/app/lib/provider-health");
    await recordProviderFailure("imdb", details);
  } catch {
    // Health persistence is unavailable in isolated adapter tests.
  }
}

async function getImdbConfig(): Promise<ImdbConfig | null> {
  const runtime = await getRuntimeEnvironment();
  const config = {
    accessKeyId: readEnv(runtime, "IMDB_AWS_ACCESS_KEY_ID"),
    secretAccessKey: readEnv(runtime, "IMDB_AWS_SECRET_ACCESS_KEY"),
    sessionToken: readEnv(runtime, "IMDB_AWS_SESSION_TOKEN") || undefined,
    dataSetId: readEnv(runtime, "IMDB_DATA_SET_ID") || readEnv(runtime, "IMDB_DATASET_ID"),
    revisionId: readEnv(runtime, "IMDB_REVISION_ID"),
    assetId: readEnv(runtime, "IMDB_ASSET_ID"),
    apiKey: readEnv(runtime, "IMDB_API_KEY"),
  };
  if (!config.accessKeyId || !config.secretAccessKey || !config.dataSetId
    || !config.revisionId || !config.assetId || !config.apiKey) return null;
  return config as ImdbConfig;
}

async function getRuntimeEnvironment() {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as Record<string, unknown>;
  } catch {
    return process.env as Record<string, unknown>;
  }
}

function readEnv(runtime: Record<string, unknown>, key: string) {
  const value = runtime[key];
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: string | null | undefined, max: number) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
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

function dateFromParts(parts: DateParts) {
  if (!parts?.year) return null;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${parts.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
