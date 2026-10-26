import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, resetSnapshotCache } = await import("../lib/store.ts");
const { clearSessionCache } = await import("../lib/session-cache.ts");
const { createDatabaseSession, verifyIdToken, revokeOtherDatabaseSessions, AUTH_SESSIONS, SESSION_COOKIE } = await import("../lib/auth.ts");
const { issueMcpToken, resolveMcpIdentity, findMcpIdentityByPublicId, MCP_IDENTITIES } = await import("../lib/mcp-auth.ts");
const { createMcpContext } = await import("../lib/mcp-context.ts");
const { runApprovedTaskAction, reviewMcpWriteApproval, MCP_APPROVAL_APPLICATIONS } = await import("../lib/mcp-controls.ts");
const { gitValidationAvailability, resolveCheckoutPath, validateGitProgress } = await import("../lib/git-validation.ts");
const { hashPassword } = await import("../lib/password.ts");
const { runAfterResponse } = await import("../lib/after-response.ts");
const login = await import("../app/api/auth/login/route.ts");
const identitiesRoute = await import("../app/api/mcp/identities/route.ts");

const adminA = { uid: "admin_a", email: "a@example.com", name: "Admin A", role: "admin", clientId: null, permissions: [] };
const adminB = { uid: "admin_b", email: "b@example.com", name: "Admin B", role: "admin", clientId: null, permissions: [] };

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  clearSessionCache();
  return db;
}

async function seedUser(user, extra = {}) {
  const store = await getStore();
  return store.upsertUser({ ...user, createdAt: new Date().toISOString(), passwordHash: hashPassword("correct-horse-1"), status: "active", authzVersion: 0, ...extra });
}

function loginRequest(email, password) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ email, password }),
  });
}

function bearer(token, publicId) {
  return new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "x-boatship-mcp-id": publicId } });
}

// Item 1: login does not reveal account state before the password is proven.
test("login answers the generic 401 for unknown, invited and reset-required accounts until the password is correct", async () => {
  fresh();
  await seedUser({ ...adminA, uid: "invited", email: "invited@example.com" }, { status: "invited" });
  await seedUser({ ...adminA, uid: "reset", email: "reset@example.com" }, { mustResetPassword: true });
  await seedUser(adminA);

  for (const email of ["nobody@example.com", "invited@example.com", "reset@example.com", "a@example.com"]) {
    const response = await login.POST(loginRequest(email, "wrong-password-9"));
    assert.equal(response.status, 401, email);
    assert.deepEqual(await response.json(), { error: "Invalid email or password" });
  }
  const invited = await login.POST(loginRequest("invited@example.com", "correct-horse-1"));
  assert.equal(invited.status, 403, "the pending state is told only to someone holding the password");
  const reset = await login.POST(loginRequest("reset@example.com", "correct-horse-1"));
  assert.equal(reset.status, 403);
  const ok = await login.POST(loginRequest("a@example.com", "correct-horse-1"));
  assert.equal(ok.status, 200);
});

// Item 2: the work runs after the response.
test("runAfterResponse runs the task outside a request and swallows its failure", async () => {
  let ran = false;
  await runAfterResponse("test", async () => { ran = true; });
  assert.equal(ran, true);
  await runAfterResponse("test", async () => { throw new Error("boom"); });
});

// Item 4: legacy sessions without a version.
test("a session record with no authzVersion counts as version 0", async () => {
  fresh();
  await seedUser(adminA, { authzVersion: 0 });
  const token = await createDatabaseSession(adminA, { authzVersion: 0 });
  const [record] = await AUTH_SESSIONS.find([{ field: "userId", op: "==", value: adminA.uid }]);
  const legacy = { ...record };
  delete legacy.authzVersion;
  await AUTH_SESSIONS.set(record.tokenHash, legacy);
  assert.ok(await verifyIdToken(token, { authoritative: true }), "a version-0 user keeps a legacy session");

  await (await getStore()).updateUserFields(adminA.uid, { authzVersion: 1 });
  clearSessionCache();
  assert.equal(await verifyIdToken(token, { authoritative: true }), null, "a later bump invalidates the legacy session");
});

// Item 3: MCP tokens follow the owner's authz version and session revocation.
test("an MCP token stops resolving after the owner's authz version changes", async () => {
  fresh();
  await seedUser(adminA);
  const issued = await issueMcpToken(adminA.uid, {});
  const identity = await findMcpIdentityByPublicId(issued.publicId);
  assert.equal(identity.authzVersion, 0);
  assert.equal(identity.issuedBy, adminA.uid);
  assert.ok(await resolveMcpIdentity(bearer(issued.token, issued.publicId)));

  await (await getStore()).updateUserFields(adminA.uid, { authzVersion: 1 });
  assert.equal(await resolveMcpIdentity(bearer(issued.token, issued.publicId)), null);
});

test("an identity stored without authzVersion is treated as version 0", async () => {
  fresh();
  await seedUser(adminA, { authzVersion: 2 });
  const issued = await issueMcpToken(adminA.uid, {});
  const identity = await findMcpIdentityByPublicId(issued.publicId);
  assert.ok(await resolveMcpIdentity(bearer(issued.token, issued.publicId)));
  const legacy = { ...identity };
  delete legacy.authzVersion;
  await MCP_IDENTITIES.set(identity.id, legacy);
  assert.equal(await resolveMcpIdentity(bearer(issued.token, issued.publicId)), null, "a pre-field token of a user whose credentials changed is refused");
});

test("revoking a user's sessions (sign out everywhere, reset) revokes their MCP tokens", async () => {
  fresh();
  await seedUser(adminA);
  await seedUser(adminB);
  const mine = await issueMcpToken(adminA.uid, {});
  const theirs = await issueMcpToken(adminB.uid, {});
  await revokeOtherDatabaseSessions(adminA.uid, "keep-this-browser");
  assert.equal(await resolveMcpIdentity(bearer(mine.token, mine.publicId)), null);
  assert.equal((await findMcpIdentityByPublicId(mine.publicId)).status, "revoked");
  assert.ok(await resolveMcpIdentity(bearer(theirs.token, theirs.publicId)), "other users are untouched");
});

// Item 5: approvals bind the payload, are single-use and need a second person.
async function approvalFixture() {
  fresh();
  await seedUser(adminA);
  await seedUser(adminB);
  const store = await getStore();
  const client = await store.createClient({ name: "Harbour", companyName: "Harbour Co", primaryContactEmail: "h@example.com", templateId: null, assignedTeamMemberId: null });
  const task = await store.createTask({ clientId: client.id, title: "Ship it", description: "", type: "general", assignedTo: null, assignedRole: "team", status: "pending", dueDate: null, order: 1, formTemplateId: null, requiresUpload: false });
  const context = await createMcpContext(adminA, "boatship_admin_a", undefined, ["tasks:write"]);
  const requested = await runApprovedTaskAction({ context, action: "add_comment", taskId: task.id, payload: { body: "Approved text" } });
  assert.equal(requested.status, "approval_required");
  return { store, task, context, approvalId: requested.approvalId };
}

test("a reviewer cannot approve their own MCP write request", async () => {
  const { approvalId } = await approvalFixture();
  await assert.rejects(reviewMcpWriteApproval({ approvalId, decision: "approved", reviewer: adminA }), (error) => error instanceof Response && error.status === 403);
  const review = await reviewMcpWriteApproval({ approvalId, decision: "approved", reviewer: adminB });
  assert.equal(review.status, "approved");
});

test("an approved write applies only the approved payload, once", async () => {
  const { task, approvalId } = await approvalFixture();
  await reviewMcpWriteApproval({ approvalId, decision: "approved", reviewer: adminB });
  // Each MCP request builds its context afresh.
  resetSnapshotCache();
  const context = await createMcpContext(adminA, "boatship_admin_a", undefined, ["tasks:write"]);

  const swapped = await runApprovedTaskAction({ context, action: "add_comment", taskId: task.id, payload: { body: "Something else entirely" }, approved: true, approvalId });
  assert.equal(swapped.status, "blocked");
  assert.match(swapped.message, /differs from the approved/);

  const other = await createMcpContext(adminB, "boatship_admin_b", undefined, ["tasks:write"]);
  const stolen = await runApprovedTaskAction({ context: other, action: "add_comment", taskId: task.id, payload: { body: "Approved text" }, approved: true, approvalId });
  assert.equal(stolen.status, "blocked", "an approval belongs to its requester");

  const results = await Promise.all([1, 2, 3].map(() => runApprovedTaskAction({ context, action: "add_comment", taskId: task.id, payload: { body: "Approved text" }, approved: true, approvalId })));
  assert.equal(results.filter((result) => result.status === "applied").length, 1, "exactly one concurrent application wins");
  resetSnapshotCache();
  const comments = await (await getStore()).listTaskComments(task.id);
  assert.deepEqual(comments.map((comment) => comment.body), ["Approved text"]);
  assert.ok(await MCP_APPROVAL_APPLICATIONS.get(approvalId));
});

// Item 6: Git validation is confined to the checkout root.
test("git validation is disabled without a checkout root and refuses paths outside it", async () => {
  assert.equal(gitValidationAvailability({}).available, false);
  const enabled = gitValidationAvailability({ BOATSHIP_GIT_CHECKOUT_ROOT: "/srv/checkouts" });
  assert.equal(enabled.available, true);

  const base = mkdtempSync(path.join(tmpdir(), "boatship-git-"));
  try {
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    mkdirSync(path.join(root, "repo"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, "escape"), "junction");

    assert.ok(await resolveCheckoutPath(root, "repo"));
    assert.ok(await resolveCheckoutPath(root));
    assert.equal(await resolveCheckoutPath(root, "../outside"), null);
    assert.equal(await resolveCheckoutPath(root, outside), null, "absolute paths outside the root are refused");
    assert.equal(await resolveCheckoutPath(root, "escape"), null, "a link out of the root is refused");
    assert.equal(await resolveCheckoutPath(root, "missing"), null);

    const previous = process.env.BOATSHIP_GIT_CHECKOUT_ROOT;
    process.env.BOATSHIP_GIT_CHECKOUT_ROOT = root;
    try {
      const evidence = await validateGitProgress("task_1", { repositoryPath: outside, baseSha: "abc123" });
      assert.equal(evidence.status, "blocked");
      assert.match(evidence.reason, /inside the configured checkout root/);
      const badCheck = await validateGitProgress("task_1", { repositoryPath: "repo", baseSha: "abc123", checks: ["rm -rf"] });
      assert.match(badCheck.reason, /unsupported check/);
      const badRef = await validateGitProgress("task_1", { repositoryPath: "repo", baseSha: "--output=/tmp/x" });
      assert.match(badRef.reason, /plain Git revisions/);
    } finally {
      if (previous === undefined) delete process.env.BOATSHIP_GIT_CHECKOUT_ROOT;
      else process.env.BOATSHIP_GIT_CHECKOUT_ROOT = previous;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Item 7: admin-minted tokens record the issuer and respect the owner's access.
test("an admin minting a token for another user records issuedBy and cannot grant projects the owner cannot open", async () => {
  fresh();
  await seedUser(adminA);
  const store = await getStore();
  const own = await store.createClient({ name: "Own", companyName: "Own Co", primaryContactEmail: "o@example.com", templateId: null, assignedTeamMemberId: null });
  const other = await store.createClient({ name: "Other", companyName: "Other Co", primaryContactEmail: "x@example.com", templateId: null, assignedTeamMemberId: null });
  await store.upsertUser({ uid: "client_1", email: "client@example.com", name: "Client", role: "client", clientId: own.id, createdAt: new Date().toISOString(), passwordHash: hashPassword("client-pass-1"), status: "active", authzVersion: 0 });
  const adminToken = await createDatabaseSession(adminA, { authzVersion: 0 });
  const post = (body) => identitiesRoute.POST(new Request("http://localhost/api/mcp/identities", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(adminToken)}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

  const denied = await post({ userId: "client_1", projectIds: [other.id] });
  assert.equal(denied.status, 400);
  const missing = await post({ userId: "client_1", projectIds: ["no_such_project"] });
  assert.equal(missing.status, 400);

  const ok = await post({ userId: "client_1", projectIds: [own.id] });
  assert.equal(ok.status, 200);
  const { identity } = await ok.json();
  const stored = await findMcpIdentityByPublicId(identity.publicId);
  assert.equal(stored.issuedBy, adminA.uid);
  assert.equal(stored.userId, "client_1");
  const { ACCOUNT_AUDIT_EVENTS } = await import("../lib/accounts.ts");
  const audit = await ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: "client_1" }]);
  const entry = audit.find((event) => event.action === "mcp.identity.issued");
  assert.ok(entry);
  assert.equal(entry.metadata.issuedBy, adminA.uid);
});

test("an applied status update does not return staff-only task fields", async () => {
  fresh();
  await seedUser(adminA);
  await seedUser(adminB);
  const store = await getStore();
  const client = await store.createClient({ name: "Fields", companyName: "Fields Co", primaryContactEmail: "f@example.com", templateId: null, assignedTeamMemberId: null });
  const task = await store.createTask({ clientId: client.id, title: "Status", description: "", type: "general", assignedTo: null, assignedRole: "team", status: "pending", dueDate: null, order: 1, formTemplateId: null, requiresUpload: false });
  let context = await createMcpContext(adminA, "boatship_admin_a", undefined, ["tasks:write"]);
  const { approvalId } = await runApprovedTaskAction({ context, action: "update_task_status", taskId: task.id, payload: { status: "completed" } });
  await reviewMcpWriteApproval({ approvalId, decision: "approved", reviewer: adminB });
  resetSnapshotCache();
  context = await createMcpContext(adminA, "boatship_admin_a", undefined, ["tasks:write"]);
  const result = await runApprovedTaskAction({ context, action: "update_task_status", taskId: task.id, payload: { status: "completed" }, approved: true, approvalId });
  assert.equal(result.status, "applied");
  assert.equal(result.task.status, "completed");
  for (const field of ["watcherIds", "escalatedAt", "reminderSentAt", "internalNotes"]) assert.equal(field in result.task, false, field);
});
