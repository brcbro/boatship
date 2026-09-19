import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
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

  // Prefer Neon's HTTP transport. The WebSocket adapter intermittently fails
  // in local Node.js with an opaque ErrorEvent when its socket cannot connect;
  // HTTP works in both `next dev` and Cloudflare Workers for this request/
  // response datastore. Do not cache this client globally: adapter I/O remains
  // request-scoped in Workers.
  return new PrismaClient({ adapter: new PrismaNeonHTTP(connectionString, {}) });
}
