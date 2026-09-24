import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

if (existsSync(".env.local")) config({ path: ".env.local", quiet: true });
if (!process.env.DIRECT_URL?.trim()) {
  console.error("DIRECT_URL is required to apply database migrations.");
  process.exit(1);
}

const prismaCli = resolve("node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
