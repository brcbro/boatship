import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { issueMcpToken, verifyMcpToken, revokeMcpIdentity, findMcpIdentityByPublicId, listMcpProjectAccess, recordMcpAuditEvent, deleteMcpIdentity, MCP_IDENTITIES, MCP_PROJECT_ACCESS, MCP_AUDIT_EVENTS } = await import("../lib/mcp-auth.ts");
const { getPolicy, DEFINITION_OF_DONE_POLICIES, TASK_MANAGER_APPROVALS, getTaskQuality, createValidationRun } = await import("../lib/git-quality.ts");
const { createRepository, findRepositoryForWebhook, GIT_TASK_LINKS, GIT_EVIDENCE, gitTaskLinkId, parseWebhookEvent } = await import("../lib/git-repositories.ts");
const { sessionHistory, auditExport } = await import("../lib/mcp-controls.ts");

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  return db;
}

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

test("issueMcpToken creates the identity and one access document per project, and the token hash resolves", async () => {
  const db = fresh();
  const issued = await issueMcpToken("user_1", { scopes: ["tasks:read", "tasks:read", "git:validate"], projectIds: ["p1", "p2", "p1"] });
  assert.ok(issued.token.startsWith("boatship_mcp_"));
  assert.deepEqual(issued.scopes, ["tasks:read", "git:validate"]);

  const identity = await findMcpIdentityByPublicId(issued.publicId);
  assert.ok(identity);
  assert.equal(identity.id, (await db.get("McpIdentity", identity.id)).id, "the id field equals the document id");
  assert.equal(identity.tokenHash, sha256(issued.token), "only the SHA-256 hash is stored");
  assert.equal(identity.status, "active");
  assert.equal(identity.lastUsedAt, null);

  const access = await listMcpProjectAccess(identity.id);
  assert.deepEqual(access.map((row) => row.projectId).sort(), ["p1", "p2"]);
  assert.ok(await db.get("McpProjectAccess", `${identity.id}__p1`), "access documents use the composite id");

  const claims = await verifyMcpToken(issued.token);
  assert.deepEqual(claims, { identityId: identity.id, publicId: issued.publicId, userId: "user_1", scopes: ["tasks:read", "git:validate"] });
  assert.ok((await MCP_IDENTITIES.get(identity.id)).lastUsedAt, "verification stamps lastUsedAt");
  assert.equal(await verifyMcpToken("boatship_mcp_not_a_real_token"), null);
  assert.equal(await verifyMcpToken("other_prefix"), null);
});

test("revoke is a compare-and-set, is idempotent, and deletes nothing", async () => {
  fresh();
  const first = await issueMcpToken("user_1", { projectIds: ["p1"] });
  const second = await issueMcpToken("user_2", { projectIds: ["p2"] });
  const firstIdentity = await findMcpIdentityByPublicId(first.publicId);
  await recordMcpAuditEvent({ identityId: firstIdentity.id, userId: "user_1", toolName: "tools/list" });

  assert.deepEqual(await revokeMcpIdentity(first.publicId), { count: 1 });
  assert.deepEqual(await revokeMcpIdentity(first.publicId), { count: 0 }, "a second revoke changes nothing");
  assert.deepEqual(await revokeMcpIdentity("boatship_mcp_missing"), { count: 0 });

  const revoked = await findMcpIdentityByPublicId(first.publicId);
  assert.equal(revoked.status, "revoked");
  assert.ok(revoked.revokedAt);
  assert.equal(await verifyMcpToken(first.token), null, "revoked tokens no longer verify");
  assert.ok(await verifyMcpToken(second.token), "other identities are untouched");

  assert.equal(await MCP_IDENTITIES.count(), 2);
  assert.equal(await MCP_PROJECT_ACCESS.count(), 2);
  assert.equal(await MCP_AUDIT_EVENTS.count(), 1);
  assert.equal((await listMcpProjectAccess(firstIdentity.id)).length, 1, "project access survives a revoke");

  await deleteMcpIdentity(firstIdentity.id);
  assert.equal(await MCP_IDENTITIES.count(), 1);
  assert.equal(await MCP_PROJECT_ACCESS.count(), 1);
  assert.equal(await MCP_AUDIT_EVENTS.count(), 0, "deleting an identity cascades to its audit events and access rows");
});

test("audit history applies the retention window in memory and sorts newest first", async () => {
  fresh();
  const issued = await issueMcpToken("user_1");
  const identity = await findMcpIdentityByPublicId(issued.publicId);
  const recorded = await recordMcpAuditEvent({ identityId: identity.id, userId: "user_1", toolName: "live", resource: "boatship://tasks", success: false, metadata: { device: "abc" } });
  const stored = await MCP_AUDIT_EVENTS.get(recorded.id);
  assert.equal(stored.action, null, "absent optionals are stored as null");
  assert.equal(stored.success, false);
  assert.ok(stored.createdAt);
  await MCP_AUDIT_EVENTS.delete(recorded.id);
  const put = (id, toolName, createdAt, metadata = null) => MCP_AUDIT_EVENTS.create(id, { id, identityId: identity.id, userId: "user_1", toolName, resource: null, action: null, success: true, metadata, createdAt });
  const recent = Date.now();
  await put("first", "first", new Date(recent - 2000).toISOString(), { token: "hidden", device: "abc" });
  await put("old", "ancient", "2000-01-01T00:00:00.000Z");
  await put("second", "second", new Date(recent - 1000).toISOString());
  const history = await sessionHistory(identity.id, 10);
  assert.deepEqual(history.map((event) => event.toolName), ["second", "first"], "events outside the retention window are excluded");
  assert.deepEqual(history[1].metadata, { device: "abc" }, "secret-looking metadata keys are stripped");
  const exported = await auditExport(undefined, "user_1");
  assert.deepEqual(exported.map((event) => event.toolName), ["second", "first"]);
});

test("policy selection prefers the task-type-specific and repository-specific policy", async () => {
  fresh();
  const base = { requiredFiles: [], requiredChecks: [], requiredBuild: false, requiredScreenshot: false, requiredApproval: false, allowedPaths: [], maxStaleHours: 72, createdBy: "admin" };
  const put = (id, extra) => DEFINITION_OF_DONE_POLICIES.create(id, { id, projectId: "project_1", repositoryId: null, taskType: null, ...base, ...extra });
  await put("generic", { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  await put("design-only", { taskType: "design", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
  await put("dev-repo", { taskType: "development", repositoryId: "repo_a", requiredApproval: true, createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" });
  await put("dev-other-repo", { taskType: "development", repositoryId: "repo_b", createdAt: "2026-01-04T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z" });
  await put("other-project", { projectId: "project_2", createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" });

  assert.equal((await getPolicy("project_1", "development", "repo_a"))?.id, "dev-repo", "type and repository match wins over the generic policy");
  assert.equal((await getPolicy("project_1", "development"))?.id, "dev-other-repo", "without a repository the newest type-matching policy wins");
  assert.equal((await getPolicy("project_1", "design"))?.id, "design-only");
  assert.equal((await getPolicy("project_1", "research"))?.id, "generic", "unknown types fall back to the untyped policy");
  assert.equal((await getPolicy("project_1", "research", "repo_a"))?.id, "generic");
  assert.equal(await getPolicy("project_3", "design"), undefined);
  assert.equal((await getPolicy("project_1"))?.id, "dev-other-repo", "no task type applies no type filter, as the former Prisma filter did");
});

test("git task links upsert by the composite id and keep their creation time", async () => {
  const db = fresh();
  const repo = await createRepository({ provider: "github", name: "acme/app", owner: "acme", repository: "app", createdBy: "admin" });
  assert.equal(repo.active, true);
  assert.equal("webhookSecretHash" in repo, false, "the summary never exposes the secret hash");
  const linkId = gitTaskLinkId("task_1", repo.id);
  assert.equal(linkId, `task_1__${repo.id}`);
  const stamp = "2026-01-01T00:00:00.000Z";
  await GIT_TASK_LINKS.set(linkId, { id: linkId, taskId: "task_1", repositoryId: repo.id, branch: "feature", pullRequestUrl: null, pullRequestId: "42", baseSha: null, headSha: null, createdAt: stamp, updatedAt: stamp });
  const existing = await GIT_TASK_LINKS.get(linkId);
  await GIT_TASK_LINKS.set(linkId, { ...existing, branch: "feature-2", updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(await GIT_TASK_LINKS.count(), 1, "the same task/repository pair stays one document");
  const updated = await db.get("GitTaskLink", linkId);
  assert.equal(updated.data.branch, "feature-2");
  assert.equal(updated.data.createdAt, stamp);
  assert.equal(updated.data.id, linkId);
});

test("webhook evidence is deduplicated per repository by externalId", async () => {
  fresh();
  const repo = await createRepository({ provider: "github", name: "acme/app", owner: "acme", repository: "app", createdBy: "admin" });
  const other = await createRepository({ provider: "github", name: "acme/other", owner: "acme", repository: "other", createdBy: "admin" });
  await createRepository({ provider: "gitlab", name: "acme/app (gitlab)", owner: "acme", repository: "app", createdBy: "admin" });
  assert.equal((await findRepositoryForWebhook("github", "acme", "app"))?.id, repo.id, "provider, owner and repository all have to match");
  assert.equal(await findRepositoryForWebhook("github", "acme", "missing"), null);

  const event = parseWebhookEvent("github", { action: "opened", pull_request: { number: 7, html_url: "https://github.com/acme/app/pull/7", head: { sha: "abc", ref: "feature" }, base: { sha: "def", ref: "main" } }, repository: { name: "app", owner: { login: "acme" } } }, new Headers({ "x-github-event": "pull_request", "x-github-delivery": "delivery-1" }));
  const externalId = `delivery:${event.deliveryId}`;
  const dedupe = async (repositoryId) => (await GIT_EVIDENCE.find([{ field: "externalId", op: "==", value: externalId }])).find((row) => row.repositoryId === repositoryId) || null;
  assert.equal(await dedupe(repo.id), null);
  const evidence = { id: randomUUID(), repositoryId: repo.id, taskId: null, kind: event.kind, title: "github pull_request opened", externalId, url: event.url, payload: { normalized: { deliveryId: event.deliveryId }, raw: event.raw }, createdAt: "2026-01-01T00:00:00.000Z" };
  await GIT_EVIDENCE.create(evidence.id, evidence);
  assert.equal((await dedupe(repo.id))?.id, evidence.id, "a redelivery is recognised");
  assert.equal(await dedupe(other.id), null, "the same delivery id for another repository is not a duplicate");

  await createValidationRun({ taskId: "task_1", status: "blocked", reason: "Webhook received.", evidence: { provider: "github", changedFiles: [], checks: [] }, source: "webhook" });
  await TASK_MANAGER_APPROVALS.set("task_1", { id: randomUUID(), taskId: "task_1", reviewerId: "manager", status: "approved", note: null, createdAt: "2026-01-01T00:00:00.000Z", reviewedAt: "2026-01-01T00:00:00.000Z" });
  await GIT_EVIDENCE.update(evidence.id, { taskId: "task_1" });
  const quality = await getTaskQuality("task_1");
  assert.equal(quality.runs.length, 1);
  assert.equal(quality.runs[0].source, "webhook");
  assert.equal(quality.evidence.length, 1);
  assert.equal(quality.approval?.status, "approved");
});
