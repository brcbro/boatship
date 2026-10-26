import { createHash } from "crypto";

/** Replays carry the same signed bytes; the delivery header is unsigned and can be changed freely. */
export function webhookBodyExternalId(body: string): string {
  return `body:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

/** The provider's own last-updated time for a PR/MR event, when the payload carries one. */
export function webhookEventUpdatedAt(payload: Record<string, unknown>): string | null {
  const pull = (payload.pull_request || payload.merge_request || payload.object_attributes) as Record<string, unknown> | undefined;
  const value = pull?.updated_at;
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
}

type PriorEvidence = { headSha?: string | null; eventUpdatedAt?: string | null };

/**
 * A signed but older delivery must not move a task link back to a superseded
 * head. Git SHAs carry no order, so an update is stale when either the provider
 * timestamp is older than one already recorded for this PR, or its head SHA was
 * recorded before and is no longer the link's current head.
 */
export function isStaleHeadUpdate(
  incoming: { headSha: string | null; eventUpdatedAt: string | null },
  currentHeadSha: string | null,
  prior: PriorEvidence[],
): boolean {
  if (!incoming.headSha || incoming.headSha === currentHeadSha) return false;
  if (incoming.eventUpdatedAt) {
    const at = Date.parse(incoming.eventUpdatedAt);
    if (prior.some((row) => row.eventUpdatedAt && Date.parse(row.eventUpdatedAt) > at)) return true;
  }
  return Boolean(currentHeadSha) && prior.some((row) => row.headSha === incoming.headSha);
}
