import { createTokenProvider, serviceAccountFromEnv } from "../../lib/google-auth.ts";
import { RestFirestore } from "../../lib/firestore/client.ts";
import { PostgresFirestore } from "../../lib/firestore/postgres.ts";

/** Shared database access for operator scripts; run with `node --import tsx`. */
export function serviceAccountProjectId() {
  const account = serviceAccountFromEnv();
  if (!account) throw new Error("FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key) is required in the process environment");
  return account.projectId;
}

/**
 * The identifier an operator must name to confirm the target: the PostgreSQL
 * host when DATABASE_URL is set, otherwise the Firebase project id. Never a
 * credential.
 */
export function storeTargetId() {
  if (process.env.FIRESTORE_EMULATOR_HOST?.trim()) return "emulator";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    try { return new URL(databaseUrl).hostname; } catch { throw new Error("DATABASE_URL is not a valid connection URL"); }
  }
  return serviceAccountProjectId();
}

export function getFirestore() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  if (emulator) return new RestFirestore({ projectId: process.env.FIREBASE_PROJECT_ID?.trim() || "demo-boatship", host: emulator.startsWith("http") ? emulator : `http://${emulator}` });
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return new PostgresFirestore({ url: databaseUrl, table: process.env.DATABASE_TABLE?.trim() || undefined, max: 2 });
  const account = serviceAccountFromEnv();
  if (!account) throw new Error("DATABASE_URL or FIREBASE_SERVICE_ACCOUNT is required");
  return new RestFirestore({ projectId: account.projectId, database: process.env.FIRESTORE_DATABASE?.trim() || "(default)", tokens: createTokenProvider(account) });
}
