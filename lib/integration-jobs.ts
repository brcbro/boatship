import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { hasPermission } from "@/lib/rbac";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { deliverIntegrationEvent, type IntegrationEvent } from "@/lib/composio";
import { provisionClientDriveFolder } from "@/lib/drive-provision";
import { LocalIntegrationJobs } from "@/lib/local-integration-jobs";
import { drainAfterResponse } from "@/lib/queue-drain";
import {
  INTEGRATION_JOB_ATTEMPTS, INTEGRATION_JOB_LEASE_MS,
  integrationJobDedupKey, integrationJobFailure, integrationJobRetryable,
  type IntegrationJob, type IntegrationJobKind, type IntegrationJobOutcome,
} from "@/lib/integration-job-policy";
import type { AuthSession } from "@/types";

type DatabaseJob = Omit<IntegrationJob, "createdAt" | "updatedAt" | "nextAttemptAt" | "leaseUntil"> & {
  createdAt: Date; updatedAt: Date; nextAttemptAt: Date; leaseUntil: Date | null;
};

function fromDatabase(job: DatabaseJob): IntegrationJob {
  return { ...job, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), nextAttemptAt: job.nextAttemptAt.toISOString(), leaseUntil: job.leaseUntil?.toISOString() ?? null };
}

function localQueue() {
  return process.env.ALLOW_LOCAL_STORE === "1" && !process.env.DATABASE_URL?.trim()
    ? new LocalIntegrationJobs(join(process.cwd(), ".data", "integration-jobs.json"))
    : null;
}

async function insertJobs(jobs: IntegrationJob[]): Promise<IntegrationJob[]> {
  const local = localQueue();
  if (local) return local.insert(jobs);
  const rows = await getPrisma().$queryRaw<DatabaseJob[]>`INSERT INTO "IntegrationJob"
    ("id", "dedupKey", "clientId", "actorId", "kind", "payload", "status", "attempts", "nextAttemptAt", "createdAt", "updatedAt")
    SELECT item."id", item."dedupKey", item."clientId", item."actorId", item."kind", item."payload", 'pending', 0, NOW(), NOW(), NOW()
    FROM jsonb_to_recordset(${JSON.stringify(jobs)}::jsonb) AS item("id" text, "dedupKey" text, "clientId" text, "actorId" text, "kind" text, "payload" jsonb)
    ON CONFLICT ("dedupKey") DO UPDATE SET "dedupKey" = EXCLUDED."dedupKey"
    RETURNING *`;
  if (rows.length) drainAfterResponse("integration", () => drainIntegrationJobs());
  return rows.map(fromDatabase);
}

function newJob(kind: IntegrationJobKind, clientId: string, actorId: string, eventKey: string, payload: Record<string, unknown>): IntegrationJob {
  const now = new Date().toISOString();
  return { id: randomUUID(), dedupKey: integrationJobDedupKey(kind, eventKey), clientId, actorId, kind, payload, status: "pending", attempts: 0, nextAttemptAt: now, leaseUntil: null, leaseToken: null, error: null, result: null, createdAt: now, updatedAt: now };
}

/** Always await persistence; no external provider is contacted on the request path. */
export async function enqueueIntegrationEvent(actorId: string, event: IntegrationEvent, eventKey: string) {
  const store = await getStore();
  const actor = await store.getUser(actorId);
  const client = actor?.role === "client" ? await store.getClient(event.clientId) : null;
  const staffActorId = client?.assignedTeamMemberId || actorId;
  const jobs = [newJob("slack.event", event.clientId, staffActorId, eventKey, { event })];
  if (event.type === "client.invited") jobs.push(newJob("hubspot.contact", event.clientId, staffActorId, eventKey, { event }));
  if (event.type === "client.created") jobs.push(newJob("drive.folder", event.clientId, staffActorId, `client.created:${event.clientId}`, {}));
  return insertJobs(jobs);
}

export async function enqueueClientDriveFolder(actorId: string, clientId: string) {
  return insertJobs([newJob("drive.folder", clientId, actorId, `client.created:${clientId}`, {})]);
}

async function claimJobs(limit: number): Promise<IntegrationJob[]> {
  const local = localQueue();
  if (local) return local.claim(limit, Date.now(), INTEGRATION_JOB_LEASE_MS, INTEGRATION_JOB_ATTEMPTS);
  const leaseToken = randomUUID();
  const rows = await getPrisma().$queryRaw<DatabaseJob[]>`WITH exhausted AS (
      UPDATE "IntegrationJob" SET "status" = 'failed', "error" = 'Delivery could not be confirmed after the last attempt.',
        "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = NOW()
      WHERE "attempts" >= ${INTEGRATION_JOB_ATTEMPTS} AND
        (("status" = 'pending' AND "nextAttemptAt" <= NOW()) OR ("status" = 'processing' AND "leaseUntil" <= NOW()))
      RETURNING "id"
    ), candidates AS (
      SELECT "id" FROM "IntegrationJob" WHERE "attempts" < ${INTEGRATION_JOB_ATTEMPTS} AND
        (("status" = 'pending' AND "nextAttemptAt" <= NOW()) OR ("status" = 'processing' AND "leaseUntil" <= NOW()))
      ORDER BY "nextAttemptAt", "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) UPDATE "IntegrationJob" AS job SET "status" = 'processing', "attempts" = job."attempts" + 1,
      "leaseToken" = ${leaseToken}, "leaseUntil" = NOW() + ${INTEGRATION_JOB_LEASE_MS} * INTERVAL '1 millisecond', "updatedAt" = NOW()
    FROM candidates WHERE job."id" = candidates."id" RETURNING job.*`;
  return rows.map(fromDatabase);
}

async function finishJob(job: IntegrationJob, outcome: IntegrationJobOutcome): Promise<boolean> {
  if (!job.leaseToken) return false;
  const local = localQueue();
  if (local) return local.finish(job.id, job.leaseToken, outcome, Date.now());
  const retryDelayMs = Math.max(0, Date.parse(outcome.nextAttemptAt) - Date.now());
  const updated = await getPrisma().$executeRaw`UPDATE "IntegrationJob" SET "status" = ${outcome.status},
    "nextAttemptAt" = NOW() + ${retryDelayMs} * INTERVAL '1 millisecond', "error" = ${outcome.error}, "result" = ${JSON.stringify(outcome.result)}::jsonb,
    "leaseUntil" = NULL, "leaseToken" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${job.id} AND "status" = 'processing' AND "leaseToken" = ${job.leaseToken}`;
  return updated > 0;
}

async function executeJob(job: IntegrationJob): Promise<IntegrationJobOutcome> {
  const store = await getStore();
  const [actor, client] = await Promise.all([store.getUser(job.actorId), store.getClient(job.clientId)]);
  const denied = { status: "failed" as const, nextAttemptAt: new Date().toISOString(), error: "The original staff member no longer has permission for this client.", result: null };
  if (!actor || !client || actor.mustResetPassword || isUnsafeDemoUser(actor) || (actor.role !== "admin" && actor.role !== "team")) return denied;
  const session: AuthSession = { uid: actor.uid, email: actor.email, name: actor.name, role: actor.role, clientId: actor.clientId, permissions: actor.permissions };
  if (!hasPermission(session, "clients.manage") || !await canAccessClient(session, job.clientId)) return denied;

  const now = new Date().toISOString();
  if (job.kind === "drive.folder") {
    const folder = await provisionClientDriveFolder(job.actorId, client);
    if (!folder) return { status: "skipped", nextAttemptAt: now, error: "Connect Google Drive, then retry this job.", result: null };
    await store.addActivity({ clientId: client.id, actorId: actor.uid, actorName: actor.name, action: "client.drive_folder", meta: { jobId: job.id, ...folder } });
    return { status: "succeeded", nextAttemptAt: now, error: null, result: { folderId: folder.folderId, folderUrl: folder.folderUrl } };
  }
  if (job.kind !== "slack.event" && job.kind !== "hubspot.contact") throw new Error("Unknown integration job kind");
  const event = job.payload.event as IntegrationEvent | undefined;
  if (!event || event.clientId !== job.clientId || !["client.created", "client.invited", "task.completed", "onboarding.completed"].includes(event.type)) {
    return { status: "failed", nextAttemptAt: now, error: "The saved integration request is invalid.", result: null };
  }
  const result = await deliverIntegrationEvent(job.actorId, event, job.kind === "slack.event" ? "slack" : "hubspot");
  return { status: result.skipped ? "skipped" : "succeeded", nextAttemptAt: now, error: result.skipped ? result.reason : null, result: result.skipped ? null : { provider: job.kind.split(".")[0], confirmed: true } };
}

/** Leases survive request interruption; provider deliveries may repeat after uncertainty. */
export async function drainIntegrationJobs(limit = 10) {
  const jobs = await claimJobs(Math.max(1, Math.min(20, Math.floor(limit))));
  const results = await Promise.all(jobs.map(async (job) => {
    let outcome: IntegrationJobOutcome;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        executeJob(job),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Integration job timed out")), 45_000); }),
      ]);
    } catch {
      // Never persist provider response text: it may include credentials or
      // private payloads. A stable generic failure is sufficient for retry UI.
      outcome = integrationJobFailure(job.attempts, "The provider did not confirm delivery. Check the connection and retry.");
      console.warn("[integrations] job delivery was not confirmed", { jobId: job.id, kind: job.kind, attempt: job.attempts });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const recorded = await finishJob(job, outcome);
    return { id: job.id, status: outcome.status, recorded };
  }));
  return { processed: jobs.length, results };
}

async function savedJobs(clientId?: string, actorId?: string): Promise<IntegrationJob[]> {
  const local = localQueue();
  if (local) return (await local.list()).filter((job) => (!clientId || job.clientId === clientId) && (!actorId || job.actorId === actorId));
  const rows = await getPrisma().$queryRaw<DatabaseJob[]>`SELECT * FROM "IntegrationJob"
    WHERE (${clientId || null}::text IS NULL OR "clientId" = ${clientId || null})
      AND (${actorId || null}::text IS NULL OR "actorId" = ${actorId || null})
    ORDER BY "createdAt" DESC LIMIT 500`;
  return rows.map(fromDatabase);
}

export async function listIntegrationJobs(session: AuthSession, clientId?: string) {
  const store = await getStore();
  if (session.role !== "admin" && session.role !== "team") return [];
  const clientRows = await store.listClients();
  const assignedIds = session.role === "team"
    ? new Set((await filterAssignedClients(session, clientRows)).map((client) => client.id)) : null;
  const visible = (await savedJobs(clientId, session.role === "team" ? session.uid : undefined))
    .filter((job) => !assignedIds || assignedIds.has(job.clientId));
  const clients = new Map(clientRows.map((client) => [client.id, client.companyName]));
  return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map((job) => ({
    id: job.id, clientId: job.clientId, clientName: clients.get(job.clientId) || "Deleted client", kind: job.kind,
    status: job.status, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt, error: job.error,
    createdAt: job.createdAt, updatedAt: job.updatedAt, retryable: integrationJobRetryable(job.status),
  }));
}

export async function retryIntegrationJob(session: AuthSession, id: string): Promise<boolean> {
  const local = localQueue();
  const job = local ? (await local.list()).find((entry) => entry.id === id)
    : (await getPrisma().$queryRaw<DatabaseJob[]>`SELECT * FROM "IntegrationJob" WHERE "id" = ${id} LIMIT 1`).map(fromDatabase)[0];
  if (!job || !integrationJobRetryable(job.status)) return false;
  if (session.role !== "admin" && (session.role !== "team" || job.actorId !== session.uid || !await canAccessClient(session, job.clientId))) return false;
  if (local) return local.retry(id, Date.now());
  const requeued = (await getPrisma().$executeRaw`UPDATE "IntegrationJob" SET "status" = 'pending', "attempts" = 0,
    "nextAttemptAt" = NOW(), "leaseUntil" = NULL, "leaseToken" = NULL, "error" = NULL, "result" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${id} AND "status" IN ('failed', 'skipped')`) > 0;
  if (requeued) drainAfterResponse("integration", () => drainIntegrationJobs());
  return requeued;
}
