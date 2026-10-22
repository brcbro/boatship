import { createHash } from "node:crypto";

export const INTEGRATION_JOB_ATTEMPTS = 10;
export const INTEGRATION_JOB_LEASE_MS = 5 * 60_000;
export const INTEGRATION_JOB_KINDS = ["slack.event", "hubspot.contact", "drive.folder"] as const;
export type IntegrationJobKind = typeof INTEGRATION_JOB_KINDS[number];
export type IntegrationJobStatus = "pending" | "processing" | "succeeded" | "skipped" | "failed";

export type IntegrationJob = {
  id: string;
  dedupKey: string;
  clientId: string;
  actorId: string;
  kind: IntegrationJobKind;
  payload: Record<string, unknown>;
  status: IntegrationJobStatus;
  attempts: number;
  nextAttemptAt: string;
  leaseUntil: string | null;
  leaseToken: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationJobOutcome = Pick<IntegrationJob, "status" | "nextAttemptAt" | "error" | "result">;

export function integrationJobDedupKey(kind: IntegrationJobKind, eventKey: string): string {
  if (!eventKey.trim() || eventKey.length > 1000) throw new Error("A bounded integration event key is required");
  return `${kind}:${createHash("sha256").update(eventKey).digest("hex")}`;
}

export function integrationJobFailure(attempts: number, message: string, now = Date.now()): IntegrationJobOutcome {
  return {
    status: attempts >= INTEGRATION_JOB_ATTEMPTS ? "failed" : "pending",
    nextAttemptAt: new Date(now + Math.min(2 ** attempts * 60_000, 3_600_000)).toISOString(),
    error: message,
    result: null,
  };
}

export function integrationJobRetryable(status: string): boolean {
  return status === "failed" || status === "skipped";
}

export function integrationJobReady(job: IntegrationJob, now: number): boolean {
  return (job.status === "pending" && Date.parse(job.nextAttemptAt) <= now) ||
    (job.status === "processing" && job.leaseUntil !== null && Date.parse(job.leaseUntil) <= now);
}

/** Provider response bodies may contain private data; store only safe confirmation fields. */
export function integrationProviderConfirmed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (record.successful !== true || (typeof record.error === "string" && record.error.trim())) return false;
  const data = integrationProviderData(result);
  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;
    if (body.ok === false || body.successful === false || (typeof body.error === "string" && body.error.trim())) return false;
  }
  return true;
}

export function integrationProviderData(result: unknown): unknown {
  if (!result || typeof result !== "object") return null;
  const data = (result as Record<string, unknown>).data;
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); } catch { return null; }
}

/** Distinguish a confirmed empty search from an absent or malformed result. */
export function integrationProviderItems(result: unknown, keys: string[]): Record<string, unknown>[] | null {
  const find = (value: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of keys) if (Array.isArray(record[key])) return find(record[key]);
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const items = find(nested);
        if (items) return items;
      }
    }
    return null;
  };
  return find(integrationProviderData(result));
}

export function integrationDriveFolderName(client: { id: string; name: string; companyName: string }): string {
  return `[Boatship] ${client.companyName} — ${client.name} (${client.id})`;
}

export function integrationCompletionEventKey(clientId: string, tasks: Array<{ id: string; completedAt: string | null; createdAt: string }>): string {
  const marker = tasks.map((task) => `${task.id}:${task.completedAt || task.createdAt}`).sort().join("|");
  return `onboarding.completed:${clientId}:${createHash("sha256").update(marker).digest("hex")}`;
}
