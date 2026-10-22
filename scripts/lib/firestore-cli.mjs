import { createTokenProvider, serviceAccountFromEnv } from "../../lib/google-auth.ts";
import { RestFirestore } from "../../lib/firestore/client.ts";

/** Shared Firestore access for operator scripts; run with `node --import tsx`. */
export function serviceAccountProjectId() {
  const account = serviceAccountFromEnv();
  if (!account) throw new Error("FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key) is required in the process environment");
  return account.projectId;
}

export function getFirestore() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  if (emulator) return new RestFirestore({ projectId: process.env.FIREBASE_PROJECT_ID?.trim() || "demo-boatship", host: emulator.startsWith("http") ? emulator : `http://${emulator}` });
  const account = serviceAccountFromEnv();
  if (!account) throw new Error("FIREBASE_SERVICE_ACCOUNT is required");
  return new RestFirestore({ projectId: account.projectId, database: process.env.FIRESTORE_DATABASE?.trim() || "(default)", tokens: createTokenProvider(account) });
}
