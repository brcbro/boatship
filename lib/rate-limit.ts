import { createHash } from "crypto";
import { getFirestore, isLocalDemoStore } from "@/lib/firestore";

type RateLimit = {
  scope: string;
  identity: string;
  max: number;
  windowSeconds: number;
};

const BUCKETS = "RateLimitBucket";
type BucketDoc = { count: number; expiresAt: string };

const localBuckets = new Map<string, { count: number; expiresAt: number }>();

/** Atomic, shared limit across Worker isolates: one transaction per request on a hashed key. */
export async function consumeRateLimit({ scope, identity, max, windowSeconds }: RateLimit): Promise<boolean> {
  if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`Invalid rate limit configuration for ${scope}`);
  }

  // Never put email addresses, tokens, or client IPs in database keys.
  const key = createHash("sha256").update(`${scope}\0${identity.trim().toLowerCase()}`).digest("hex");
  if (isLocalDemoStore() && process.env.NODE_ENV !== "production") {
    const now = Date.now();
    const existing = localBuckets.get(key);
    const next = existing && existing.expiresAt > now
      ? { ...existing, count: existing.count + 1 }
      : { count: 1, expiresAt: now + windowSeconds * 1000 };
    localBuckets.set(key, next);
    return next.count <= max;
  }
  const firestore = getFirestore();
  const count = await firestore.runTransaction(async (tx) => {
    const now = Date.now();
    const bucket = await tx.get<BucketDoc>(BUCKETS, key);
    const expired = !bucket || new Date(bucket.data.expiresAt).getTime() <= now;
    const next: BucketDoc = expired
      ? { count: 1, expiresAt: new Date(now + windowSeconds * 1000).toISOString() }
      : { count: bucket.data.count + 1, expiresAt: bucket.data.expiresAt };
    tx.write({ set: { collection: BUCKETS, id: key, data: next } });
    return next.count;
  }, { attempts: 8 });
  // Opportunistically remove cold identities without adding a scheduled job.
  // This only deletes buckets that expired at least a day ago.
  if (Math.random() < 0.002) {
    try {
      const stale = await firestore.query({ collection: BUCKETS, where: [{ field: "expiresAt", op: "<", value: new Date(Date.now() - 86_400_000).toISOString() }], limit: 200 });
      if (stale.length) await firestore.commit(stale.map((doc) => ({ delete: { collection: BUCKETS, id: doc.id } })));
    } catch (error) {
      console.error("Expired rate-limit bucket cleanup failed", error);
    }
  }
  return count <= max;
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
