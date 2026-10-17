import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const build = spawnSync(process.execPath, [cli, "build"], {
  stdio: "inherit", timeout: 180_000,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: ".wrangler/build.log" },
});
if (build.status !== 0) {
  console.error(build.error?.message ?? `Build failed (${build.signal ?? build.status}).`);
  process.exit(1);
}
const workerPath = fileURLToPath(new URL("../dist/server/index.js", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
const { default: worker } = await import(pathToFileURL(workerPath).href);
if (typeof worker?.fetch !== "function" || manifest.d1 !== "DB") throw new Error("Invalid Worker artifact or missing D1 binding declaration.");
console.log("Validated Worker fetch handler and D1 binding declaration.");
