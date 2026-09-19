/**
 * Small Redis REST cache for Cloudflare-compatible deployments.
 *
 * Upstash Redis exposes this API directly. The cache is intentionally
 * best-effort: an unavailable Redis instance must never make Boatship's API
 * unavailable or return data that belongs to a different cache generation.
 */
type RedisResponse = { result?: unknown };

const CACHE_PREFIX = "boatship:cache:v1";
const VERSION_KEY = `${CACHE_PREFIX}:version`;

function config() {
  const url = process.env.REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" ? { url, token } : null;
  } catch {
    return null;
  }
}

async function command(command: string[]): Promise<unknown | null> {
  const settings = config();
  if (!settings) return null;

  try {
    const response = await fetch(`${settings.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command]),
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as RedisResponse[];
    return body[0]?.result ?? null;
  } catch {
    return null;
  }
}

export async function getRedisCacheVersion(): Promise<number> {
  const value = await command(["GET", VERSION_KEY]);
  const version = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

/** Advance the cache generation only after the canonical datastore was saved. */
export async function bumpRedisCacheVersion(): Promise<void> {
  await command(["INCR", VERSION_KEY]);
}

/** Keep request filters out of Redis key names while retaining stable lookup keys. */
export async function redisCacheKey(scope: string, input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${scope}:${hash}`;
}

export async function withRedisCache<T>(
  name: string,
  version: number,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> {
  const key = `${CACHE_PREFIX}:${version}:${name}`;
  const cached = await command(["GET", key]);

  if (typeof cached === "string") {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // A malformed entry is treated as a miss and overwritten below.
    }
  }

  const value = await load();
  // Do not cache failed JSON serialization (for example, a future response
  // containing a non-serializable value); the fresh response remains valid.
  try {
    await command(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)]);
  } catch {
    // command is already fail-open, kept for future implementation changes.
  }
  return value;
}
