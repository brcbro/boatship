import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import {
  assertFirstAdminEligible,
  checkedDatabaseHost,
  normalizeBootstrapInput,
} from "./lib/bootstrap-admin.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: node scripts/provision-first-admin.mjs --expect-host HOST [--apply]");
  console.log("Set DIRECT_URL, BOATSHIP_ADMIN_EMAIL, BOATSHIP_ADMIN_NAME and BOATSHIP_ADMIN_PASSWORD in the process environment.");
  console.log("Without --apply, the command only inspects eligibility. It never prints the password or database URL.");
  process.exit(0);
}
const apply = args.includes("--apply");
const remaining = args.filter((arg) => arg !== "--apply");
if (remaining.length !== 2 || remaining[0] !== "--expect-host" || args.filter((arg) => arg === "--apply").length > 1) {
  throw new Error("Expected --expect-host HOST and optional --apply only; run --help");
}

const connectionString = process.env.DIRECT_URL?.trim();
if (!connectionString) throw new Error("DIRECT_URL is required in the process environment");
const host = checkedDatabaseHost(connectionString, remaining[1]);
const input = normalizeBootstrapInput({
  email: process.env.BOATSHIP_ADMIN_EMAIL,
  name: process.env.BOATSHIP_ADMIN_NAME,
  password: process.env.BOATSHIP_ADMIN_PASSWORD,
});
const sql = neon(connectionString);

let [snapshot] = await sql`SELECT data, version FROM "StoreSnapshot" WHERE id = 'main'`;
const profiles = await sql`SELECT email, role FROM "UserProfile" WHERE role = 'admin' OR lower(email) = ${input.email}`;
assertFirstAdminEligible(snapshot?.data ?? { users: [] }, profiles, input.email);
if (!apply) {
  console.log(`Eligible for first-admin provisioning on ${host}. Snapshot version: ${snapshot?.version ?? "absent"}.`);
  console.log("Re-run with --apply after reviewing the target database and migration state.");
  process.exit(0);
}

if (!snapshot) {
  // A fresh migrated database may not have served a request yet. The app
  // normalizes collections absent from this minimal initial snapshot.
  await sql`INSERT INTO "StoreSnapshot" (id, data, version, "updatedAt")
            VALUES ('main', '{"users":[]}'::jsonb, 0, NOW())
            ON CONFLICT (id) DO NOTHING`;
  [snapshot] = await sql`SELECT data, version FROM "StoreSnapshot" WHERE id = 'main'`;
  assertFirstAdminEligible(snapshot?.data ?? { users: [] }, profiles, input.email);
}

if (!snapshot) throw new Error("Could not initialize StoreSnapshot(main)");
const uid = randomUUID();
const createdAt = new Date().toISOString();
const salt = randomBytes(16).toString("hex");
const passwordHash = `${salt}:${scryptSync(input.password, salt, 64).toString("hex")}`;
const user = {
  uid,
  email: input.email,
  name: input.name,
  role: "admin",
  clientId: null,
  createdAt,
  inviteToken: null,
  inviteTokenExpiresAt: null,
  mustResetPassword: false,
  password: null,
  passwordHash,
  permissions: [],
};

// This is one SQL statement. A concurrent snapshot update or existing admin
// makes the CTE return zero rows, and the profile insert then also inserts
// zero rows. A profile insert error rolls back the snapshot update.
const inserted = await sql`
  WITH updated AS (
    UPDATE "StoreSnapshot" s
    SET data = jsonb_set(
          s.data,
          '{users}',
          COALESCE(s.data->'users', '[]'::jsonb) || ${JSON.stringify(user)}::jsonb,
          true
        ),
        version = s.version + 1,
        "updatedAt" = NOW()
    WHERE s.id = 'main'
      AND s.version = ${snapshot.version}
      AND jsonb_typeof(COALESCE(s.data->'users', '[]'::jsonb)) = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.data->'users') = 'array' THEN s.data->'users' ELSE '[]'::jsonb END
        ) AS users(user_json)
        WHERE users.user_json->>'role' = 'admin'
           OR lower(users.user_json->>'email') = ${input.email}
      )
      AND NOT EXISTS (
        SELECT 1 FROM "UserProfile" p WHERE p.role = 'admin' OR lower(p.email) = ${input.email}
      )
    RETURNING s.id
  )
  INSERT INTO "UserProfile" (
    uid, email, name, role, "clientId", "createdAt", "inviteToken",
    "inviteTokenExpiresAt", "mustResetPassword", password, "passwordHash",
    permissions, "digestEnabled", "lastDigestAt", "updatedAt"
  )
  SELECT ${uid}, ${input.email}, ${input.name}, 'admin', NULL, ${createdAt}::timestamp,
         NULL, NULL, false, NULL, ${passwordHash}, ARRAY[]::text[], false, NULL, NOW()
  FROM updated
  RETURNING uid
`;
if (inserted.length !== 1) {
  throw new Error("Provisioning was not applied; an administrator/email appeared or the snapshot changed. Recheck and retry.");
}
console.log(`Created first administrator ${input.email} on ${host}.`);
