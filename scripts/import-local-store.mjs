import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { PrismaClient } from "../generated/prisma/client/index.js";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });
config();

const connectionString = (process.env.DIRECT_URL || process.env.DATABASE_URL)?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const raw = JSON.parse(await readFile(".data/store.json", "utf8"));
const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

for (const user of raw.users || []) {
  if (user.email === "admin@boatship.local" && !user.passwordHash) {
    user.passwordHash = hashPassword("admin123");
  }
  if (user.email === "team@boatship.local" && !user.passwordHash) {
    user.passwordHash = hashPassword("team123");
  }
  delete user.password;
}

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
await prisma.storeSnapshot.upsert({
  where: { id: "main" },
  create: { id: "main", data: raw },
  update: { data: raw },
});
await prisma.$disconnect();
console.log("Imported .data/store.json into Neon StoreSnapshot(main).");
