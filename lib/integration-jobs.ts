import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Collection, getFirestore, isLocalDemoStore, nowIso, PostgresFirestore, type FirestoreTransaction } from "@/lib/firestore";
import { getStore } from "@/lib/store";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { hasPermission } from "@/lib/rbac";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { accountCanAuthenticate } from "@/lib/account-status";
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

/** Firestore mirror of the former table; timestamps are ISO strings. */
export const INTEGRATION_JOBS = new Collection<IntegrationJob>("IntegrationJob");

function localQueue() {
  return isLocalDemoStore()
    ? new LocalIntegrationJobs(join(process.cwd(), ".data", "integration-jobs.json"))
    : null;
}

const due = (job: IntegrationJob, now: string) =>
  (job.status === "pending" && job.nextAttemptAt <= now) || (job.status === "processing" && Boolean(job.leaseUntil) && job.leaseUntil! <= now);

async function dueJobs(tx: FirestoreTransaction, now: string): Promise<IntegrationJob[]> {
  // Equality-only queries avoid composite indexes; the due filter runs in memory
  // over the small set of unfinished jobs.
  const [pending, processing] = await Promise.all([
    tx.query<IntegrationJob>(INTEGRATION_JOBS.spec([{ field: "status", op: "==", value: "pending" }])),
    tx.query<IntegrationJob>(INTEGRATION_JOBS.spec([{ field: "status", op: "==", value: "processing" }])),
  ]);
  return [...pending, ...processing].map((doc) => ({ ...doc.data, id: doc.id })).filter((job) => due(job, now));
}

async function insertJobs(jobs: IntegrationJob[]): Promise<IntegrationJob[]> {
  const local = localQueue();
  if (local) return local.insert(jobs);
  const rows = await getFirestore().runTransaction(async (tx) => {
    const result: IntegrationJob[] = [];
    for (const job of jobs) {
      const existing = await tx.query<IntegrationJob>(INTEGRATION_JOBS.spec([{ field: "dedupKey", op: "==", value: job.dedupKey }], { limit: 1 }));
      if (existing.length) { result.push({ ...existing[0].data, id: existing[0].id }); continue; }
      tx.write({ set: { collection: INTEGRATION_JOBS.name, id: job.id, data: job, precondition: { exists: false } } });
      result.push(job);
    }
    return result;
  });
  if (rows.length) drainAfterResponse("integration", () => drainIntegrationJobs());
  return rows;
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
  // One transaction per batch replaces FOR UPDATE SKIP LOCKED: a competing
  // drain aborts on commit, retries, and claims whatever is still due.
  return getFirestore().runTransaction(async (tx) => {
    const now = nowIso();
    const candidates = await dueJobs(tx, now);
    const claimed: IntegrationJob[] = [];
    for (const job of candidates.filter((item) => item.attempts >= INTEGRATION_JOB_ATTEMPTS)) {
      tx.write({ update: { collection: INTEGRATION_JOBS.name, id: job.id, data: { status: "failed", error: "Delivery could not be confirmed after the last attempt.", leaseToken: null, leaseUntil: null, updatedAt: now } } });
    }
    const eligible = candidates.filter((item) => item.attempts < INTEGRATION_JOB_ATTEMPTS)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    for (const job of eligible) {
      const patch = { status: "processing" as const, attempts: job.attempts + 1, leaseToken, leaseUntil: new Date(Date.now() + INTEGRATION_JOB_LEASE_MS).toISOString(), updatedAt: now };
      tx.write({ update: { collection: INTEGRATION_JOBS.name, id: job.id, data: patch } });
      claimed.push({ ...job, ...patch });
    }
    return claimed;
  }, { attempts: 8 });
}

async function finishJob(job: IntegrationJob, outcome: IntegrationJobOutcome): Promise<boolean> {
  if (!job.leaseToken) return false;
  const local = localQueue();
  if (local) return local.finish(job.id, job.leaseToken, outcome, Date.now());
  const nextAttemptAt = new Date(Math.max(Date.now(), Date.parse(outcome.nextAttemptAt))).toISOString();
  return getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<IntegrationJob>(INTEGRATION_JOBS.name, job.id);
    if (!current || current.data.status !== "processing" || current.data.leaseToken !== job.leaseToken) return false;
    tx.write({ update: { collection: INTEGRATION_JOBS.name, id: job.id, data: { status: outcome.status, nextAttemptAt, error: outcome.error, result: outcome.result as IntegrationJob["result"], leaseUntil: null, leaseToken: null, updatedAt: nowIso() } } });
    return true;
  });
}

async function executeJob(job: IntegrationJob): Promise<IntegrationJobOutcome> {
  const store = await getStore();
  const [actor, client] = await Promise.all([store.getUser(job.actorId), store.getClient(job.clientId)]);
  const denied = { status: "failed" as const, nextAttemptAt: new Date().toISOString(), error: "The original staff member no longer has permission for this client.", result: null };
  if (!actor || !client || !accountCanAuthenticate(actor) || isUnsafeDemoUser(actor) || (actor.role !== "admin" && actor.role !== "team")) return denied;
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

/** Most jobs read for the jobs list (which shows the newest 100 after access filtering). */
const SAVED_JOBS_LIMIT = 500;

async function savedJobs(clientId?: string, actorId?: string): Promise<IntegrationJob[]> {
  const local = localQueue();
  if (local) return (await local.list()).filter((job) => (!clientId || job.clientId === clientId) && (!actorId || job.actorId === actorId));
  const where = [
    ...(clientId ? [{ field: "clientId", op: "==" as const, value: clientId }] : []),
    ...(actorId ? [{ field: "actorId", op: "==" as const, value: actorId }] : []),
  ];
  // PostgreSQL sorts and limits in the database. The Firestore fallback would
  // need a composite index for equality plus ordering, so it keeps the
  // in-memory sort over the filtered set.
  if (getFirestore() instanceof PostgresFirestore) return INTEGRATION_JOBS.find(where, { orderBy: [{ field: "createdAt", direction: "desc" }], limit: SAVED_JOBS_LIMIT });
  return (await INTEGRATION_JOBS.find(where)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, SAVED_JOBS_LIMIT);
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
  const job = local ? (await local.list()).find((entry) => entry.id === id) : await INTEGRATION_JOBS.get(id);
  if (!job || !integrationJobRetryable(job.status)) return false;
  if (session.role !== "admin" && (session.role !== "team" || job.actorId !== session.uid || !await canAccessClient(session, job.clientId))) return false;
  if (local) return local.retry(id, Date.now());
  const requeued = await getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<IntegrationJob>(INTEGRATION_JOBS.name, id);
    if (!current || !integrationJobRetryable(current.data.status)) return false;
    const now = nowIso();
    tx.write({ update: { collection: INTEGRATION_JOBS.name, id, data: { status: "pending", attempts: 0, nextAttemptAt: now, leaseUntil: null, leaseToken: null, error: null, result: null, updatedAt: now } } });
    return true;
  });
  if (requeued) drainAfterResponse("integration", () => drainIntegrationJobs());
  return requeued;
}
