import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { createTokenProvider, serviceAccountFromEnv } from "../lib/google-auth.ts";

/**
 * Creates every composite index listed in firestore.indexes.json through the
 * Firestore Admin API, so deploys do not depend on the Firebase CLI login.
 * The emulator never needs indexes, which is why this must run against the
 * real project before a query that requires one goes live.
 * Usage: node --import tsx scripts/firestore-indexes.mjs [--dry-run]
 */
config({ path: ".env.local", quiet: true });
const dryRun = process.argv.includes("--dry-run");
const account = serviceAccountFromEnv();
if (!account) throw new Error("FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key) is required");
const database = process.env.FIRESTORE_DATABASE?.trim() || "(default)";
const tokens = createTokenProvider(account);
const { indexes = [] } = JSON.parse(await readFile("firestore.indexes.json", "utf8"));
if (!indexes.length) { console.log("No composite indexes declared; nothing to create."); process.exit(0); }

for (const index of indexes) {
  const body = { queryScope: index.queryScope || "COLLECTION", fields: index.fields.map((field) => ({ fieldPath: field.fieldPath, ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : { order: field.order || "ASCENDING" }) })) };
  const label = `${index.collectionGroup}(${body.fields.map((field) => `${field.fieldPath} ${field.order || field.arrayConfig}`).join(", ")})`;
  if (dryRun) { console.log(`Would create ${label}`); continue; }
  const url = `https://firestore.googleapis.com/v1/projects/${account.projectId}/databases/${encodeURIComponent(database)}/collectionGroups/${index.collectionGroup}/indexes`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${await tokens(["https://www.googleapis.com/auth/datastore"])}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (response.status === 409) { console.log(`Exists: ${label}`); continue; }
  if (!response.ok) throw new Error(`Index creation failed for ${label}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  console.log(`Creating ${label} (builds in the background)`);
}
