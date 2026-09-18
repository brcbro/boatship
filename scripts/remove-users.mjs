import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

const requestedEmails = String(process.env.BOATSHIP_REMOVE_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
if (!requestedEmails.length) throw new Error("BOATSHIP_REMOVE_EMAILS is required");

const sql = neon(connectionString);
const rows = await sql`SELECT data FROM "StoreSnapshot" WHERE id = 'main' LIMIT 1`;
if (!rows[0]) throw new Error("StoreSnapshot(main) does not exist");

const data = rows[0].data;
const users = Array.isArray(data.users) ? data.users : [];
const targets = users.filter((user) => requestedEmails.includes(String(user.email || "").toLowerCase()));
const foundEmails = new Set(targets.map((user) => String(user.email).toLowerCase()));
const missing = requestedEmails.filter((email) => !foundEmails.has(email));
if (missing.length) throw new Error(`No account found for: ${missing.join(", ")}`);

const targetIds = new Set(targets.map((user) => user.uid));
data.users = users.filter((user) => !targetIds.has(user.uid));
if (Array.isArray(data.notifications)) {
  data.notifications = data.notifications.filter((item) => !targetIds.has(item.userId));
}

await sql`UPDATE "StoreSnapshot" SET data = ${JSON.stringify(data)}::jsonb, "updatedAt" = NOW() WHERE id = 'main'`;
for (const userId of targetIds) {
  await sql`DELETE FROM "AuthSession" WHERE "userId" = ${userId}`;
}

for (const user of targets) console.log(`Removed ${user.name} <${user.email}>`);
console.log(`Remaining users: ${data.users.length}`);
