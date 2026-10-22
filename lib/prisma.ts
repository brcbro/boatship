import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";

declare global {
  var boatshipLoopbackPool: { connectionString: string; pool: Pool; client: PrismaClient } | undefined;
  interface CloudflareEnv {
    // Optional until a real [[hyperdrive]] binding is added to wrangler.toml.
    HYPERDRIVE?: { connectionString: string };
  }
}

function getHyperdriveConnectionString() {
  try {
    return getCloudflareContext().env.HYPERDRIVE?.connectionString.trim();
  } catch {
    // `next dev`, build-time evaluation, and non-Cloudflare runtimes do not
    // have an OpenNext request context. They use DATABASE_URL below.
    return undefined;
  }
}

export function getPrisma() {
  const hyperdriveConnectionString = getHyperdriveConnectionString();
  if (hyperdriveConnectionString) {
    // Hyperdrive provides the regional connection pool. Keep this client
    // request-scoped; sharing Workers I/O objects between requests is unsafe.
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString: hyperdriveConnectionString }),
    });
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "A HYPERDRIVE binding or DATABASE_URL is required. Configure the pooled Neon connection string in .env.local."
    );
  }

  // Native PostgreSQL on loopback supports isolated local integration tests
  // without redirecting any application traffic to a hosted database.
  const databaseHost = new URL(connectionString).hostname;
  if (["localhost", "127.0.0.1", "[::1]"].includes(databaseHost)) {
    // Local Node requests share a bounded transport pool. Do not apply this
    // to hosted Workers, whose network objects are request-bound.
    if (globalThis.boatshipLoopbackPool?.connectionString !== connectionString || !globalThis.boatshipLoopbackPool.client) {
      void globalThis.boatshipLoopbackPool?.pool.end().catch(() => undefined);
      const pool = new Pool({ connectionString, max: 8, idleTimeoutMillis: 1000, connectionTimeoutMillis: 5000 });
      pool.on("error", () => console.error("Local PostgreSQL idle connection failed"));
      globalThis.boatshipLoopbackPool = { connectionString, pool, client: new PrismaClient({ adapter: new PrismaPg(pool) }) };
    }
    return globalThis.boatshipLoopbackPool.client;
  }

  // Prefer Neon's HTTP transport. The WebSocket adapter intermittently fails
  // in local Node.js with an opaque ErrorEvent when its socket cannot connect;
  // HTTP works in both `next dev` and Cloudflare Workers for this request/
  // response datastore. Do not cache this client globally: adapter I/O remains
  // request-scoped in Workers.
  return new PrismaClient({ adapter: new PrismaNeonHTTP(connectionString, {}) });
}
