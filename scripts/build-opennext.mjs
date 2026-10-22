import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const cli = resolve("node_modules/@opennextjs/cloudflare/dist/cli/index.js");

// Next traces @opentelemetry/api through its CommonJS entry, but the OpenNext
// middleware bundle resolves the package's ESM entry. Add the ESM files to the
// middleware trace so the copied package is complete. Route traces are covered
// by outputFileTracingIncludes in next.config.ts; middleware has no such key.
const middlewareTrace = resolve(".next/server/middleware.js.nft.json");
const esmRoot = resolve("node_modules/@opentelemetry/api/build/esm");
if (existsSync(middlewareTrace) && existsSync(esmRoot)) {
  const trace = JSON.parse(readFileSync(middlewareTrace, "utf8"));
  const files = new Set(trace.files);
  const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const full = join(dir, entry.name); if (entry.isDirectory()) walk(full); else files.add(relative(dirname(middlewareTrace), full).split("\\").join("/")); } };
  walk(esmRoot);
  if (files.size !== trace.files.length) writeFileSync(middlewareTrace, JSON.stringify({ ...trace, files: [...files] }));
}
const preload = process.platform === "win32" ? ["--import", pathToFileURL(resolve("scripts/lib/windows-build-links.mjs")).href] : [];
const result = spawnSync(process.execPath, [...preload, cli, "build", ...process.argv.slice(2)], {
  stdio: "inherit", env: process.env, windowsHide: true,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
