import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalIntegrationJobs } from "../lib/local-integration-jobs.ts";
import {
  INTEGRATION_JOB_ATTEMPTS, INTEGRATION_JOB_LEASE_MS,
  integrationJobDedupKey, integrationJobFailure, integrationJobRetryable,
  integrationProviderConfirmed, integrationProviderData, integrationProviderItems, integrationDriveFolderName,
  integrationCompletionEventKey,
} from "../lib/integration-job-policy.ts";

const now = Date.parse("2026-10-14T12:00:00.000Z");
const job = (id, kind = "slack.event") => ({ id, dedupKey: integrationJobDedupKey(kind, id), clientId: "client-1", actorId: "staff-1", kind, payload: {}, status: "pending", attempts: 0, nextAttemptAt: new Date(now).toISOString(), leaseUntil: null, leaseToken: null, error: null, result: null, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });

async function local(t) {
  const root = resolve(tmpdir());
  const directory = await mkdtemp(join(root, "boatship-integration-tests-"));
  t.after(async () => {
    assert.equal(resolve(directory).startsWith(`${root}${sep}`), true);
    await rm(directory, { recursive: true, force: true });
  });
  return { queue: new LocalIntegrationJobs(join(directory, "jobs.json")), path: join(directory, "jobs.json") };
}

test("event dedup keys are stable, provider-specific and do not expose source data", () => {
  const event = "client.invited:private@example.test:activity-1";
  const key = integrationJobDedupKey("slack.event", event);
  assert.equal(key, integrationJobDedupKey("slack.event", event));
  assert.notEqual(key, integrationJobDedupKey("hubspot.contact", event));
  assert.equal(key.includes("private@example.test"), false);
  assert.throws(() => integrationJobDedupKey("slack.event", ""));
});

test("retry backoff is bounded and ten failures stop automatic retries", () => {
  assert.equal(integrationJobFailure(1, "failure", now).nextAttemptAt, new Date(now + 120_000).toISOString());
  assert.equal(integrationJobFailure(9, "failure", now).nextAttemptAt, new Date(now + 3_600_000).toISOString());
  assert.equal(integrationJobFailure(9, "failure", now).status, "pending");
  assert.equal(integrationJobFailure(10, "failure", now).status, "failed");
  assert.equal(integrationJobRetryable("processing"), false);
  assert.equal(integrationJobRetryable("succeeded"), false);
  assert.equal(integrationJobRetryable("failed"), true);
  assert.equal(integrationJobRetryable("skipped"), true);
});

test("provider failure wrappers and nested failures never count as completed deliveries", () => {
  for (const result of [undefined, null, {}, { successful: false }, { successful: true, error: "provider failure" }, { successful: true, data: { ok: false } }, { successful: true, data: '{"error":"expired"}' }]) assert.equal(integrationProviderConfirmed(result), false);
  assert.equal(integrationProviderConfirmed({ successful: true, data: { ok: true } }), true);
  assert.deepEqual(integrationProviderData({ successful: true, data: '{"id":"folder-1"}' }), { id: "folder-1" });
  assert.deepEqual(integrationProviderItems({ successful: true, data: { files: [] } }, ["files"]), []);
  assert.deepEqual(integrationProviderItems({ successful: true, data: '{"response_data":{"results":[{"id":"contact-1"}]}}' }, ["results"]), [{ id: "contact-1" }]);
  assert.equal(integrationProviderItems({ successful: true, data: {} }, ["files"]), null);
  assert.equal(integrationProviderItems({ successful: true, data: { scopes: [] } }, ["files"]), null);
});

test("Drive and completion identifiers remain stable across retries and distinct for repeated lifecycles", () => {
  assert.notEqual(integrationDriveFolderName({ id: "client-a", name: "Same", companyName: "Same" }), integrationDriveFolderName({ id: "client-b", name: "Same", companyName: "Same" }));
  const tasks = [{ id: "task-a", completedAt: "2026-10-14", createdAt: "2026-10-10" }, { id: "task-b", completedAt: "2026-10-13", createdAt: "2026-10-10" }];
  const marker = integrationCompletionEventKey("client-a", tasks);
  assert.equal(marker, integrationCompletionEventKey("client-a", [...tasks].reverse()));
  assert.notEqual(marker, integrationCompletionEventKey("client-a", [{ ...tasks[0], completedAt: "2026-10-15" }, tasks[1]]));
});

test("local queue survives recreation and duplicate enqueue never resets completed work", async (t) => {
  const { queue, path } = await local(t);
  await queue.insert([job("job-1")]);
  const [claimed] = await queue.claim(1, now, INTEGRATION_JOB_LEASE_MS, INTEGRATION_JOB_ATTEMPTS);
  assert.equal(await queue.finish(claimed.id, claimed.leaseToken, { status: "succeeded", nextAttemptAt: new Date(now).toISOString(), error: null, result: { confirmed: true } }, now), true);
  const recreated = new LocalIntegrationJobs(path);
  const [duplicate] = await recreated.insert([{ ...job("replacement-id"), dedupKey: job("job-1").dedupKey }]);
  assert.equal(duplicate.id, "job-1");
  assert.equal(duplicate.status, "succeeded");
  assert.equal((await recreated.list()).length, 1);
});

test("concurrent claimers get disjoint jobs and cannot finish each other's stale lease", async (t) => {
  const { queue, path } = await local(t);
  await queue.insert([job("job-1"), job("job-2")]);
  const other = new LocalIntegrationJobs(path);
  const [a, b] = await Promise.all([queue.claim(1, now, INTEGRATION_JOB_LEASE_MS, 10), other.claim(1, now, INTEGRATION_JOB_LEASE_MS, 10)]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].id, b[0].id);
  const [reclaimed] = await queue.claim(1, now + INTEGRATION_JOB_LEASE_MS + 1, INTEGRATION_JOB_LEASE_MS, 10);
  assert.equal(reclaimed.attempts, 2);
  assert.notEqual(reclaimed.leaseToken, a[0].leaseToken);
  assert.equal(await queue.finish(a[0].id, a[0].leaseToken, { status: "succeeded", nextAttemptAt: new Date(now).toISOString(), error: null, result: null }, now), false);
});

test("failed attempts wait for retry time while successful siblings stay completed", async (t) => {
  const { queue } = await local(t);
  await queue.insert([job("slack-1"), job("drive-1", "drive.folder")]);
  const [slack, drive] = await queue.claim(2, now, INTEGRATION_JOB_LEASE_MS, 10);
  await queue.finish(slack.id, slack.leaseToken, { status: "succeeded", nextAttemptAt: new Date(now).toISOString(), error: null, result: null }, now);
  await queue.finish(drive.id, drive.leaseToken, integrationJobFailure(drive.attempts, "failure", now), now);
  assert.equal((await queue.claim(2, now + 60_000, INTEGRATION_JOB_LEASE_MS, 10)).length, 0);
  const retried = await queue.claim(2, now + 120_000, INTEGRATION_JOB_LEASE_MS, 10);
  assert.deepEqual(retried.map((entry) => entry.id), [drive.id]);
});

test("an interrupted last attempt becomes a terminal failure and can be explicitly retried", async (t) => {
  const { queue } = await local(t);
  await queue.insert([{ ...job("job-1"), attempts: 9 }]);
  const [last] = await queue.claim(1, now, INTEGRATION_JOB_LEASE_MS, 10);
  assert.equal(last.attempts, 10);
  assert.equal((await queue.claim(1, now + INTEGRATION_JOB_LEASE_MS + 1, INTEGRATION_JOB_LEASE_MS, 10)).length, 0);
  assert.equal((await queue.list())[0].status, "failed");
  assert.equal(await queue.retry(last.id, now + INTEGRATION_JOB_LEASE_MS + 2), true);
  const [again] = await queue.claim(1, now + INTEGRATION_JOB_LEASE_MS + 3, INTEGRATION_JOB_LEASE_MS, 10);
  assert.equal(again.attempts, 1);
  assert.equal(again.id, last.id);
  assert.equal(await queue.retry(again.id, now), false);
});

test("corrupt local queue data fails visibly instead of losing queued work", async (t) => {
  const { queue, path } = await local(t);
  await writeFile(path, "invalid json");
  await assert.rejects(() => queue.insert([job("job-1")]));
});
