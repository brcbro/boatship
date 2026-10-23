#!/usr/bin/env node
// Usage: node scripts/worker-secrets.mjs [--dry-run]
//
// Restores the Worker secrets from .env.local without printing any value.
// Internal secrets the app generates for itself (cron and realtime tickets)
// are created with random values when .env.local lacks them, and written back
// so local development matches production. Provider secrets that are not in
// .env.local are listed at the end for manual `wrangler secret put`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const envPath = resolve(".env.local");
if (!existsSync(envPath)) throw new Error(".env.local is required");
const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
const values = new Map();
for (const line of lines) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match && match[2].trim()) values.set(match[1], match[2].trim().replace(/^"(.*)"$/, "$1"));
}

const FROM_ENV = ["DATABASE_URL", "BOATSHIP_SECRETS_MASTER_KEY", "FIREBASE_SERVICE_ACCOUNT", "FIREBASE_CLIENT_EMAIL", "FIREBASE_STORAGE_BUCKET", "COMPOSIO_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "ZEPTOMAIL_API_KEY", "ZEPTOMAIL_FROM", "RESEND_API_KEY", "RESEND_FROM", "REDIS_REST_URL", "REDIS_REST_TOKEN", "WEBHOOK_ALLOWED_ORIGINS"];
const GENERATED = ["BOATSHIP_CRON_SECRET", "MESSAGE_REALTIME_SECRET"];

const appended = [];
for (const name of GENERATED) {
  if (!values.get(name)) {
    const value = randomBytes(32).toString("hex");
    values.set(name, value);
    appended.push(`${name}=${value}`);
  }
}
if (appended.length && !dryRun) {
  const kept = [...lines];
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  writeFileSync(envPath, [...kept, ...appended, ""].join("\n"));
  console.log(`Generated ${appended.map((entry) => entry.split("=")[0]).join(", ")} and saved them to .env.local.`);
}

const set = [];
const missing = [];
for (const name of [...FROM_ENV, ...GENERATED]) {
  const value = values.get(name);
  if (!value) { missing.push(name); continue; }
  if (dryRun) { set.push(name); continue; }
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "secret", "put", name, "--config", "wrangler.production.toml"], { input: value, stdio: ["pipe", "ignore", "inherit"], shell: process.platform === "win32" });
  if (result.status !== 0) { console.error(`Setting ${name} failed.`); process.exit(result.status ?? 1); }
  set.push(name);
}
console.log(`${dryRun ? "Would set" : "Set"} ${set.length} Worker secrets: ${set.join(", ")}`);
if (missing.length) console.log(`Not in .env.local, set manually if the feature is used: ${missing.join(", ")}`);
