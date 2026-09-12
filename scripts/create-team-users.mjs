import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });
config();

const connectionString = process.env.DIRECT_URL?.trim();
if (!connectionString) throw new Error("DIRECT_URL is required");

const requested = JSON.parse(process.env.BOATSHIP_USERS_JSON || "[]");
if (!Array.isArray(requested) || requested.length === 0) {
  throw new Error("BOATSHIP_USERS_JSON must contain at least one user");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const snapshot = await prisma.storeSnapshot.findUnique({ where: { id: "main" } });
if (!snapshot) throw new Error("StoreSnapshot(main) does not exist; run db:push first");

const data = snapshot.data;
const users = Array.isArray(data.users) ? data.users : [];
const permissions = ["clients.view", "clients.manage", "documents.review", "forms.review", "analytics.view"];

for (const input of requested) {
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const name = String(input.name || email.split("@")[0]).trim();
  if (!email || !password) throw new Error(`Missing email or password for ${email || "user"}`);

  const existing = users.find((user) => user.email?.toLowerCase() === email);
  const user = {
    ...(existing || {}),
    uid: existing?.uid || randomUUID(),
    email,
    name,
    role: "team",
    clientId: null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    inviteToken: null,
    inviteTokenExpiresAt: null,
    mustResetPassword: false,
    password: null,
    passwordHash: hashPassword(password),
    permissions,
  };

  if (existing) users[users.indexOf(existing)] = user;
  else users.push(user);
  console.log(`Created or updated ${email}`);
}

data.users = users;
await prisma.storeSnapshot.update({ where: { id: "main" }, data: { data } });
await prisma.$disconnect();
console.log(`Composio configured: ${Boolean(process.env.COMPOSIO_API_KEY?.trim())}`);
console.log(`OpenRouter configured: ${Boolean(process.env.OPENROUTER_API_KEY?.trim())}`);
