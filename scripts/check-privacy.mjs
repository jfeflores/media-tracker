import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Inspect only files actually selected for publication. Never print matched values.
let paths;
try { paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean); }
catch { throw new Error("Run from the Git checkout after adding the release files to the index."); }
if (!paths.length) throw new Error("No tracked files found. Add the release files before scanning.");
const rules = [
  ["credential token", /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{25,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["credential URL", /https?:\/\/[^/\s:@]+:[^/\s@]+@/],
  ["private deployment identifier", /\b(?:appgprj|oaiapp|libfile)_[a-zA-Z0-9]+|[a-z0-9.-]+\.chatgpt\.site\b/],
  ["private media fixture", new RegExp(["PERSONAL", "MEDIA", "SEEDS"].join("_") + "|" + ["WATCHLIST", "IMPORT", "V1"].join("_") + "|anime-history-\\d{3}")],
  ["absolute workstation path", /["'\s](?:\/workspace\/|\/Users\/|\/root\/|[A-Z]:\\Users\\)/],
];
const emailPattern = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const safeEmail = (email) => /^noreply@github\.com$/i.test(email) || /@(?:example\.(?:com|org|net|invalid)|[\w.-]+\.example|users\.noreply\.github\.com)$/i.test(email);
const issues = [];
function inspect(label, data) {
  const buffer = Buffer.from(data);
  if (buffer.subarray(0, 16).toString().startsWith("SQLite format 3") || buffer.includes(0)) {
    issues.push(`${label}: binary/database content requires manual exclusion`);
    return;
  }
  const text = buffer.toString("utf8");
  try {
    const json = JSON.parse(text);
    if (json.application === "Media Tracker" && Array.isArray(json.items) && json.items.length) issues.push(`${label}: populated library export`);
  } catch { /* Most source files are not JSON. */ }
  if (label.endsWith(".env.example") && text.split(/\r?\n/).some((line) => /^\w+\s*=\s*\S/.test(line))) issues.push(`${label}: populated environment template`);
  for (const [name, regex] of rules) if (regex.test(text)) issues.push(`${label}: ${name}`);
  if ([...text.matchAll(emailPattern)].some(([email]) => !safeEmail(email))) issues.push(`${label}: non-example email`);
}
for (const path of paths) {
  if (/(?:^|\/)(?:node_modules|dist|\.vinext|\.wrangler|\.sites-runtime|backups|exports)(?:\/|$)|\.tsbuildinfo$|\.(?:db|sqlite|dump|pem|key|p12|pfx)(?:$|-)/.test(path)
    || /(?:^|\/)\.env(?!\.example$)/.test(path) || /(?:^|\/)\.dev\.vars(?!\.example$)/.test(path)
    || /^wrangler\.jsonc?$/.test(path)) issues.push(`${path}: private/generated file type`);
  inspect(path, readFileSync(path));
  // Inspect the staged bytes too: a clean working file cannot conceal an older staged copy.
  inspect(`index:${path}`, execFileSync("git", ["show", `:${path}`], { maxBuffer: 16 * 1024 * 1024 }));
}
if (process.argv.includes("--history")) {
  const objects = execFileSync("git", ["rev-list", "--all", "--objects"], { encoding: "utf8" });
  for (const line of objects.trim().split("\n").filter(Boolean)) {
    const [sha, ...name] = line.split(" ");
    if (execFileSync("git", ["cat-file", "-t", sha], { encoding: "utf8" }).trim() === "blob") {
      inspect(`history:${name.join(" ") || "blob"}`, execFileSync("git", ["cat-file", "blob", sha], { maxBuffer: 16 * 1024 * 1024 }));
    }
  }
  const identities = execFileSync("git", ["log", "--all", "--format=%aE%n%cE"], { encoding: "utf8" });
  inspect("commit identities", identities);
}
const unique = [...new Set(issues)];
if (unique.length) {
  console.error(`Privacy check failed (${unique.length} findings; values redacted):\n${unique.join("\n")}`);
  process.exitCode = 1;
} else console.log(`Privacy patterns passed for ${paths.length} tracked files${process.argv.includes("--history") ? " and reachable history" : ""}. Manual review is also required.`);
