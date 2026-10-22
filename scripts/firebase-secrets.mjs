#!/usr/bin/env node
// Usage: node scripts/firebase-secrets.mjs <path-to-service-account.json> [bucket-name]
//
// Writes FIREBASE_STORAGE_BUCKET and FIREBASE_SERVICE_ACCOUNT into .env.local
// (replacing existing lines) and sets the same two Worker secrets through
// Wrangler. The key file is read here and never printed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [keyPath, bucketArg] = process.argv.slice(2);
if (!keyPath) { console.error("Usage: node scripts/firebase-secrets.mjs <service-account.json> [bucket-name]"); process.exit(1); }

const account = JSON.parse(readFileSync(resolve(keyPath), "utf8"));
if (typeof account.client_email !== "string" || typeof account.private_key !== "string") { console.error("That file is not a service-account key (missing client_email/private_key)."); process.exit(1); }

const envPath = resolve(".env.local");
const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const existingBucket = lines.find((line) => line.startsWith("FIREBASE_STORAGE_BUCKET="))?.slice("FIREBASE_STORAGE_BUCKET=".length).trim();
const bucket = bucketArg || existingBucket || `${account.project_id}.firebasestorage.app`;
const compact = JSON.stringify(account);
const kept = lines.filter((line) => !line.startsWith("FIREBASE_STORAGE_BUCKET=") && !line.startsWith("FIREBASE_SERVICE_ACCOUNT="));
while (kept.length && kept[kept.length - 1] === "") kept.pop();
writeFileSync(envPath, [...kept, `FIREBASE_STORAGE_BUCKET=${bucket}`, `FIREBASE_SERVICE_ACCOUNT=${compact}`, ""].join("\n"));
console.log(`.env.local updated for bucket ${bucket} (service account ${account.client_email}).`);

for (const [name, value] of [["FIREBASE_STORAGE_BUCKET", bucket], ["FIREBASE_SERVICE_ACCOUNT", compact]]) {
  const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "secret", "put", name], { input: value, stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
  if (result.status !== 0) { console.error(`Setting Worker secret ${name} failed.`); process.exit(result.status ?? 1); }
}
console.log("Worker secrets set. Rotate the key in the Firebase console if it was ever shared in chat.");
