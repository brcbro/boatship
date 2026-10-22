import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cli = resolve("node_modules/@opennextjs/cloudflare/dist/cli/index.js");
const preload = process.platform === "win32" ? ["--import", pathToFileURL(resolve("scripts/lib/windows-build-links.mjs")).href] : [];
const result = spawnSync(process.execPath, [...preload, cli, "build", ...process.argv.slice(2)], {
  stdio: "inherit", env: process.env, windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
