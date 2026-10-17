export type RuntimeEnvironment = Record<string, unknown>;

export async function getRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as RuntimeEnvironment;
  } catch {
    return process.env;
  }
}

export function envText(env: RuntimeEnvironment, key: string): string {
  return typeof env[key] === "string" ? env[key].trim() : "";
}
