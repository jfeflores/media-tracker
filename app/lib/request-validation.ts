export const MAX_JSON_BYTES = 64 * 1024;

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function isTrustedWriteOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.get("origin");
  // Caller-controlled forwarding headers do not enlarge this allowlist.
  if (origin) return origin === new URL(request.url).origin;
  return fetchSite === "same-origin" || (process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname));
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_JSON_BYTES) {
          await reader.cancel();
          throw new ApiRequestError("The request is too large.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    return value as Record<string, unknown>;
  } catch { throw new ApiRequestError("The request contains invalid JSON.", 400); }
}
