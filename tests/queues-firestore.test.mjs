import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore } = await import("../lib/store.ts");
const { enqueueIntegrationEvent, drainIntegrationJobs, retryIntegrationJob, INTEGRATION_JOBS } = await import("../lib/integration-jobs.ts");
const { createHodiActionProposal, consumeHodiActionProposal, finishHodiActionProposal, releaseHodiActionProposal, listHodiActionProposals, upsertHodiQueueItem, listHodiQueue, HODI_ACTION_PROPOSALS } = await import("../lib/hodi-queue.ts");

const admin = { uid: "admin", email: "a@x", name: "Admin", role: "admin", clientId: null, permissions: [] };

async function seed() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  const store = await getStore();
  await store.upsertUser({ uid: "admin", email: "a@x", name: "Admin", role: "admin", clientId: null, createdAt: new Date().toISOString(), permissions: [] });
  const client = await store.createClient({ name: "Harbour", companyName: "Harbour Studio", primaryContactEmail: "h@example.com", templateId: null, assignedTeamMemberId: "admin" });
  return { db, store, client };
}

test("integration jobs dedupe on enqueue and are claimed once across concurrent drains", async () => {
  const { client } = await seed();
  const event = { type: "client.invited", clientId: client.id, clientName: client.name, companyName: client.companyName };
  const first = await enqueueIntegrationEvent("admin", event, "invite:1");
  const second = await enqueueIntegrationEvent("admin", event, "invite:1");
  assert.equal(first.length, 2, "slack + hubspot jobs");
  assert.deepEqual(second.map((job) => job.id).sort(), first.map((job) => job.id).sort(), "duplicate enqueue returns the existing jobs");
  assert.equal(await INTEGRATION_JOBS.count(), 2);

  // Provider calls are not configured, so each claim ends as skipped/failed; what
  // matters here is that concurrent drains never process the same job twice.
  const drains = await Promise.all([drainIntegrationJobs(5), drainIntegrationJobs(5), drainIntegrationJobs(5)]);
  const processed = drains.flatMap((drain) => drain.results.map((result) => result.id));
  assert.equal(new Set(processed).size, processed.length, "no job claimed twice");
  assert.equal(processed.length, 2);
  const jobs = await INTEGRATION_JOBS.find([]);
  assert.ok(jobs.every((job) => job.status !== "processing" && job.leaseToken === null), "leases are released after finishing");
  assert.ok(jobs.every((job) => job.attempts === 1));
});

test("exhausted jobs fail permanently and failed jobs can be retried by an authorized staff member", async () => {
  const { db, client } = await seed();
  const [job] = await enqueueIntegrationEvent("admin", { type: "task.completed", clientId: client.id, clientName: client.name, companyName: client.companyName, taskTitle: "T" }, "task:1");
  await db.commit([{ update: { collection: "IntegrationJob", id: job.id, data: { attempts: 10, status: "processing", leaseUntil: "2000-01-01T00:00:00.000Z", leaseToken: "stale" } } }]);
  const drain = await drainIntegrationJobs(5);
  assert.equal(drain.processed, 0, "an exhausted job is not claimed");
  const failed = await INTEGRATION_JOBS.get(job.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.leaseToken, null);
  assert.equal(await retryIntegrationJob(admin, job.id), true);
  const requeued = await INTEGRATION_JOBS.get(job.id);
  assert.equal(requeued.status, "pending");
  assert.equal(requeued.attempts, 0);
  assert.equal(await retryIntegrationJob({ ...admin, uid: "other", role: "team" }, job.id), false, "pending jobs are not retryable");
});

test("action proposals use compare-and-set for consume, finish and release, and expire on listing", async () => {
  await seed();
  const expiresAt = new Date(Date.now() + 60_000);
  const proposal = await createHodiActionProposal({ approvalToken: "tok", action: "create_task", payload: { a: 1 }, payloadHash: "h", userId: "admin", preview: {}, expiresAt });
  assert.equal((await listHodiActionProposals(admin, "pending")).length, 1);
  const claims = await Promise.allSettled([1, 2].map(() => consumeHodiActionProposal({ approvalToken: "tok", action: "create_task", payloadHash: "h", userId: "admin" })));
  assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1, "only one executor wins the claim");
  await assert.rejects(consumeHodiActionProposal({ approvalToken: "tok", action: "create_task", payloadHash: "wrong", userId: "admin" }));
  await releaseHodiActionProposal(proposal.id, "pending");
  assert.equal((await HODI_ACTION_PROPOSALS.get(proposal.id)).status, "pending");
  await consumeHodiActionProposal({ approvalToken: "tok", action: "create_task", payloadHash: "h", userId: "admin" });
  await finishHodiActionProposal(proposal.id);
  assert.equal((await HODI_ACTION_PROPOSALS.get(proposal.id)).status, "consumed");
  await assert.rejects(finishHodiActionProposal(proposal.id), /could not be finalized/);

  const stale = await createHodiActionProposal({ approvalToken: "old", action: "x", payload: {}, payloadHash: "h", userId: "admin", preview: {}, expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await listHodiActionProposals(admin, "pending")).length, 0);
  assert.equal((await HODI_ACTION_PROPOSALS.get(stale.id)).status, "expired");
});

test("queue items upsert by dedupe key and list by priority, skipping snoozed and dismissed work", async () => {
  const { client } = await seed();
  const first = await upsertHodiQueueItem({ dedupeKey: "k1", clientId: client.id, kind: "blocker", source: "t", title: "One", summary: "s", priority: "low" });
  const again = await upsertHodiQueueItem({ dedupeKey: "k1", clientId: client.id, kind: "blocker", source: "t", title: "One updated", summary: "s", priority: "urgent" });
  assert.equal(again.id, first.id);
  assert.equal(again.title, "One updated");
  await upsertHodiQueueItem({ dedupeKey: "k2", clientId: client.id, kind: "blocker", source: "t", title: "Two", summary: "s", priority: "high" });
  const snoozed = await upsertHodiQueueItem({ dedupeKey: "k3", clientId: client.id, kind: "blocker", source: "t", title: "Three", summary: "s" });
  const { HODI_QUEUE_ITEMS } = await import("../lib/hodi-queue.ts");
  await HODI_QUEUE_ITEMS.update(snoozed.id, { snoozedUntil: new Date(Date.now() + 60_000).toISOString(), status: "snoozed" });
  const listed = await listHodiQueue(admin, { clientId: client.id });
  assert.deepEqual(listed.map((item) => item.title), ["One updated", "Two"], "urgent first, snoozed hidden");
});
