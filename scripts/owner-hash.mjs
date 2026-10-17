import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";

// Input stays off command-line arguments and shell history. Output is a hash.
const rl = createInterface({ input: process.stdin, output: process.stderr });
const email = (await rl.question("Owner email (used locally to compute its hash): ")).trim().toLowerCase();
rl.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
console.log(createHash("sha256").update(email).digest("hex"));
