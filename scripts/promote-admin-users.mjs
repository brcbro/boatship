import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });
config();

const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

const email = String(process.env.BOATSHIP_ADMIN_EMAIL || "").trim().toLowerCase();
const name = String(process.env.BOATSHIP_ADMIN_NAME || "").trim();
const password = String(process.env.BOATSHIP_ADMIN_PASSWORD || "");
const promoteAll = process.env.BOATSHIP_PROMOTE_ALL_ADMINS === "1";
if (!email || !name || !password) {
  throw new Error("BOATSHIP_ADMIN_EMAIL, BOATSHIP_ADMIN_NAME, and BOATSHIP_ADMIN_PASSWORD are required");
}

function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}

const sql = neon(connectionString);
const rows = await sql`SELECT data FROM "StoreSnapshot" WHERE id = 'main' LIMIT 1`;
if (!rows[0]) throw new Error("StoreSnapshot(main) does not exist; run db:push first");

const data = rows[0].data;
const users = Array.isArray(data.users) ? data.users : [];
if (promoteAll) {
  for (const user of users) {
    user.role = "admin";
    user.clientId = null;
    user.permissions = [];
  }
}

const existing = users.find((user) => String(user.email || "").toLowerCase() === email);
const admin = {
  ...(existing || {}),
  uid: existing?.uid || randomUUID(),
  email,
  name,
  role: "admin",
  clientId: null,
  createdAt: existing?.createdAt || new Date().toISOString(),
  inviteToken: null,
  inviteTokenExpiresAt: null,
  mustResetPassword: false,
  password: null,
  passwordHash: hashPassword(password),
  permissions: [],
};

if (existing) users[users.indexOf(existing)] = admin;
else users.push(admin);
data.users = users;

await sql`UPDATE "StoreSnapshot" SET data = ${JSON.stringify(data)}::jsonb, "updatedAt" = NOW() WHERE id = 'main'`;
console.log(`Created or updated admin: ${email}`);
console.log(`Total admin users: ${users.filter((user) => user.role === "admin").length}`);
