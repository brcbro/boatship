import { createHash } from "crypto";
import { getPrisma } from "@/lib/prisma";

type RateLimit = {
  scope: string;
  identity: string;
  max: number;
  windowSeconds: number;
};

const localBuckets = new Map<string, { count: number; expiresAt: number }>();

/** Atomic, shared limit across Worker isolates. Apply the migration before deployment. */
export async function consumeRateLimit({ scope, identity, max, windowSeconds }: RateLimit): Promise<boolean> {
  if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`Invalid rate limit configuration for ${scope}`);
  }

  // Never put email addresses, tokens, or client IPs in database keys.
  const key = createHash("sha256").update(`${scope}\0${identity.trim().toLowerCase()}`).digest("hex");
  if (!process.env.DATABASE_URL && process.env.ALLOW_LOCAL_STORE === "1" && process.env.NODE_ENV !== "production") {
    const now = Date.now();
    const existing = localBuckets.get(key);
    const next = existing && existing.expiresAt > now
      ? { ...existing, count: existing.count + 1 }
      : { count: 1, expiresAt: now + windowSeconds * 1000 };
    localBuckets.set(key, next);
    return next.count <= max;
  }
  const rows = await getPrisma().$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP
        THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= CURRENT_TIMESTAMP
        THEN CURRENT_TIMESTAMP + (${windowSeconds} * INTERVAL '1 second')
        ELSE "RateLimitBucket"."expiresAt" END
    RETURNING "count"
  `;
  // Opportunistically remove cold identities without adding a scheduled job.
  // This only deletes buckets that expired at least a day ago.
  if (Math.random() < 0.002) {
    try {
      await getPrisma().$executeRaw`
        DELETE FROM "RateLimitBucket"
        WHERE "expiresAt" < CURRENT_TIMESTAMP - INTERVAL '1 day'
      `;
    } catch (error) {
      console.error("Expired rate-limit bucket cleanup failed", error);
    }
  }
  return rows[0].count <= max;
}

export function requestIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("true-client-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export async function consumeAccountAndIpLimit(input: {
  scope: string;
  account: string;
  req: Request;
  accountMax: number;
  ipMax: number;
  windowSeconds: number;
}): Promise<boolean> {
  // Charge both buckets even if the first is exhausted, so rotating account
  // names cannot bypass the IP quota and rotating IPs cannot bypass the account quota.
  const accountAllowed = await consumeRateLimit({
    scope: `${input.scope}:account`, identity: input.account,
    max: input.accountMax, windowSeconds: input.windowSeconds,
  });
  const ipAllowed = await consumeRateLimit({
    scope: `${input.scope}:ip`, identity: requestIp(input.req),
    max: input.ipMax, windowSeconds: input.windowSeconds,
  });
  return accountAllowed && ipAllowed;
}
