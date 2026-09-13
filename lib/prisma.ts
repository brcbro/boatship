import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

export function getPrisma() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required. Configure the pooled Neon connection string in .env.local."
    );
  }

  // Neon adapter I/O is request-scoped in Cloudflare Workers. Do not cache
  // this client globally or concurrent requests can reuse another request's
  // native I/O object and fail with a Workers 1101 exception.
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
}
