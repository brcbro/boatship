import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { assertFirstAdminEligible, normalizeBootstrapInput } from "./lib/bootstrap-admin.mjs";
import { getFirestore, serviceAccountProjectId } from "./lib/firestore-cli.mjs";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: node --import tsx scripts/provision-first-admin.mjs --expect-project PROJECT_ID [--apply]");
  console.log("Set FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key), BOATSHIP_ADMIN_EMAIL, BOATSHIP_ADMIN_NAME and BOATSHIP_ADMIN_PASSWORD in the process environment.");
  console.log("Without --apply, the command only inspects eligibility. It never prints the password or credentials.");
  process.exit(0);
}
const apply = args.includes("--apply");
const remaining = args.filter((arg) => arg !== "--apply");
if (remaining.length !== 2 || remaining[0] !== "--expect-project" || args.filter((arg) => arg === "--apply").length > 1) {
  throw new Error("Expected --expect-project PROJECT_ID and optional --apply only; run --help");
}

const projectId = serviceAccountProjectId();
if (projectId !== remaining[1]) throw new Error(`Refusing to run: credentials belong to project ${projectId}, not ${remaining[1]}`);
const input = normalizeBootstrapInput({
  email: process.env.BOATSHIP_ADMIN_EMAIL,
  name: process.env.BOATSHIP_ADMIN_NAME,
  password: process.env.BOATSHIP_ADMIN_PASSWORD,
});
const firestore = getFirestore();

async function readState(reader) {
  const [meta, usersSlice] = await Promise.all([reader.get("StoreSnapshot", "main"), reader.get("StoreSnapshot", "main:users")]);
  const snapshotUsers = usersSlice ? JSON.parse(usersSlice.data.json) : [];
  const profiles = (await reader.query({ collection: "UserProfile" })).map((doc) => ({ email: doc.data.email, role: doc.data.role }));
  return { meta, snapshotUsers, profiles };
}

const state = await readState(firestore);
assertFirstAdminEligible({ users: state.snapshotUsers }, state.profiles, input.email);
if (!apply) {
  console.log(`Eligible for first-admin provisioning on ${projectId}. Snapshot version: ${state.meta?.data.version ?? "absent"}.`);
  console.log("Re-run with --apply after reviewing the target project.");
  process.exit(0);
}

const uid = randomUUID();
const createdAt = new Date().toISOString();
const salt = randomBytes(16).toString("hex");
const passwordHash = `${salt}:${scryptSync(input.password, salt, 64).toString("hex")}`;
const user = {
  uid, email: input.email, name: input.name, role: "admin", clientId: null, createdAt,
  inviteToken: null, inviteTokenExpiresAt: null, mustResetPassword: false, password: null, passwordHash, permissions: [],
};

// One transaction: a concurrent snapshot change or a newly appeared admin
// aborts the commit instead of creating a second administrator.
await firestore.runTransaction(async (tx) => {
  const current = await readState(tx);
  assertFirstAdminEligible({ users: current.snapshotUsers }, current.profiles, input.email);
  const version = (current.meta?.data.version ?? 0) + 1;
  tx.write({ set: { collection: "StoreSnapshot", id: "main:users", data: { json: JSON.stringify([...current.snapshotUsers, user]), version } } });
  tx.write({ set: { collection: "StoreSnapshot", id: "main", data: { version, updatedAt: createdAt } } });
  tx.write({ set: { collection: "UserProfile", id: uid, data: { ...user, digestEnabled: false, lastDigestAt: null }, precondition: { exists: false } } });
});
console.log(`Created first administrator ${input.email} on ${projectId}.`);
