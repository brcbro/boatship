import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, resetSnapshotCache } = await import("../lib/store.ts");
const { clearSessionCache } = await import("../lib/session-cache.ts");
const { createDatabaseSession } = await import("../lib/auth.ts");
const { hashPassword } = await import("../lib/password.ts");
const { filterAssignedClients } = await import("../lib/client-access.ts");
const { clientSafeTask, clientSafeActivity, clientCanSeeDocument, CLIENT_VISIBLE_ACTIVITY } = await import("../lib/client-projection.ts");
const { approvalReviewError } = await import("../lib/project-operations.ts");
const { clientUpdateSchema, clientCreateSchema, parseClientInput, isActiveStaffUser } = await import("../lib/client-validation.ts");
const { sanitizeForMcp, createMcpContext, taskDetails, visibleTasks } = await import("../lib/mcp-context.ts");
const tasksRoute = await import("../app/api/tasks/route.ts");
const taskRoute = await import("../app/api/tasks/[id]/route.ts");
const evidenceRoute = await import("../app/api/tasks/[id]/evidence/route.ts");
const activityRoute = await import("../app/api/activity/route.ts");
const documentsRoute = await import("../app/api/documents/route.ts");
const documentRoute = await import("../app/api/documents/[id]/route.ts");
const searchRoute = await import("../app/api/search/route.ts");
const opsRoute = await import("../app/api/project-operations/route.ts");
const clientRoute = await import("../app/api/clients/[id]/route.ts");
const clientsRoute = await import("../app/api/clients/route.ts");
const bulkRoute = await import("../app/api/clients/bulk/route.ts");
const queueRoute = await import("../app/api/hodi/queue/route.ts");
const queueItemRoute = await import("../app/api/hodi/queue/[id]/route.ts");

const BASE = "https://app.example";
const now = () => new Date().toISOString();
const admin = { uid: "admin", email: "admin@example.com", name: "Admin", role: "admin", clientId: null, permissions: [] };

async function setup() {
  setFirestoreForTests(new MemoryFirestore());
  resetSnapshotCache();
  clearSessionCache();
  const store = await getStore();
  await store.upsertUser({ ...admin, createdAt: now(), passwordHash: hashPassword("admin-password-1"), status: "active", authzVersion: 0 });
  const client = await store.createClient({ name: "Ada", companyName: "Acme", primaryContactEmail: "ada@acme.test", assignedTeamMemberId: "admin", templateId: null });
  const other = await store.createClient({ name: "Bo", companyName: "Other", primaryContactEmail: "bo@other.test", assignedTeamMemberId: "admin", templateId: null });
  const clientUser = { uid: "client-user", email: "ada@acme.test", name: "Ada", role: "client", clientId: client.id };
  await store.upsertUser({ ...clientUser, createdAt: now(), passwordHash: hashPassword("client-password-1"), status: "active", authzVersion: 0 });
  const base = { clientId: client.id, description: "", assignedTo: null, status: "pending", dueDate: null, order: 1, formTemplateId: null, requiresUpload: false };
  const facing = await store.createTask({ ...base, title: "Sign contract", type: "client_facing", assignedRole: "client", internalNotes: "SECRET-NOTE", watcherIds: ["admin"], escalatedAt: now() });
  const internal = await store.createTask({ ...base, title: "Internal review", type: "internal", assignedRole: "team", internalNotes: "INTERNAL-ONLY", order: 2 });
  const doc = (taskId, fileName) => ({ clientId: client.id, taskId, fileName, storagePath: `x/${fileName}`, uploadedBy: "admin", status: "pending_review", reviewNote: "", contentType: "application/pdf", size: 1, documentType: null, expiresAt: null, versions: [] });
  const facingDoc = await store.createDocument(doc(facing.id, "facing-report.pdf"));
  const internalDoc = await store.createDocument(doc(internal.id, "internal-report.pdf"));
  const accountDoc = await store.createDocument(doc(null, "account-report.pdf"));
  const adminToken = await createDatabaseSession(admin);
  const clientToken = await createDatabaseSession(clientUser);
  return { store, client, other, clientUser, facing, internal, facingDoc, internalDoc, accountDoc, adminToken, clientToken };
}

function call(handler, token, path, { method = "GET", body, params } = {}) {
  const req = new Request(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: BASE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req);
}

async function json(response) {
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test("a client never receives internal task fields; staff still do", async () => {
  const ctx = await setup();
  const asClient = await json(await call(tasksRoute.GET, ctx.clientToken, `/api/tasks?clientId=${ctx.client.id}`));
  assert.equal(asClient.status, 200);
  assert.deepEqual(asClient.body.tasks.map((task) => task.id), [ctx.facing.id], "only client-facing tasks");
  for (const field of ["internalNotes", "watcherIds", "escalatedAt", "reminderSentAt", "metadata"]) {
    assert.equal(field in asClient.body.tasks[0], false, `${field} is withheld`);
  }
  assert.equal(JSON.stringify(asClient.body).includes("SECRET-NOTE"), false);

  const asStaff = await json(await call(tasksRoute.GET, ctx.adminToken, `/api/tasks?clientId=${ctx.client.id}`));
  assert.equal(asStaff.body.tasks.find((task) => task.id === ctx.facing.id).internalNotes, "SECRET-NOTE");

  const patched = await json(await call(taskRoute.PATCH, ctx.clientToken, `/api/tasks/${ctx.facing.id}`, { method: "PATCH", body: { status: "in_progress" }, params: { id: ctx.facing.id } }));
  assert.equal(patched.status, 200);
  assert.equal(patched.body.task.status, "in_progress");
  assert.equal("internalNotes" in patched.body.task, false);
});

test("MCP never returns internal notes, and a client token sees only its client-facing tasks", async () => {
  const ctx = await setup();
  const context = await createMcpContext(ctx.clientUser, "mcp-test");
  const tasks = await visibleTasks(context);
  assert.deepEqual(tasks.map((task) => task.id), [ctx.facing.id]);
  assert.equal(tasks[0].internalNotes, "");
  const details = await taskDetails(context, ctx.facing.id);
  assert.equal(JSON.stringify(details).includes("SECRET-NOTE"), false);
  assert.equal(details.documents.some((document) => document.id === ctx.internalDoc.id), false);
  assert.equal(await taskDetails(context, ctx.internal.id), null);
  assert.equal("internalNotes" in sanitizeForMcp({ task: { internalNotes: "x", title: "t" } }).task, false);
});

test("a client cannot read evidence for an internal task or another client's task", async () => {
  const ctx = await setup();
  const internal = await call(evidenceRoute.GET, ctx.clientToken, `/api/tasks/${ctx.internal.id}/evidence`, { params: { id: ctx.internal.id } });
  assert.equal(internal.status, 404);
  const missing = await call(evidenceRoute.GET, ctx.clientToken, "/api/tasks/nope/evidence", { params: { id: "nope" } });
  assert.equal(missing.status, 404);
  const otherTask = await ctx.store.createTask({ clientId: ctx.other.id, title: "Theirs", description: "", type: "client_facing", assignedTo: null, assignedRole: "client", status: "pending", dueDate: null, order: 1, formTemplateId: null, requiresUpload: false });
  assert.equal((await call(evidenceRoute.GET, ctx.clientToken, `/api/tasks/${otherTask.id}/evidence`, { params: { id: otherTask.id } })).status, 404);
  assert.equal((await call(evidenceRoute.GET, ctx.clientToken, `/api/tasks/${ctx.facing.id}/evidence`, { params: { id: ctx.facing.id } })).status, 200);
  assert.equal((await call(evidenceRoute.GET, ctx.adminToken, `/api/tasks/${ctx.internal.id}/evidence`, { params: { id: ctx.internal.id } })).status, 200);
});

test("documents linked to internal tasks are hidden from clients in lists, reads and search", async () => {
  const ctx = await setup();
  const list = await json(await call(documentsRoute.GET, ctx.clientToken, `/api/documents?clientId=${ctx.client.id}`));
  assert.deepEqual(list.body.documents.map((document) => document.id).sort(), [ctx.facingDoc.id, ctx.accountDoc.id].sort());
  const staffList = await json(await call(documentsRoute.GET, ctx.adminToken, `/api/documents?clientId=${ctx.client.id}`));
  assert.equal(staffList.body.documents.length, 3);
  assert.equal((await call(documentRoute.GET, ctx.clientToken, `/api/documents/${ctx.internalDoc.id}`, { params: { id: ctx.internalDoc.id } })).status, 404);
  assert.equal((await call(documentRoute.GET, ctx.clientToken, `/api/documents/${ctx.facingDoc.id}`, { params: { id: ctx.facingDoc.id } })).status, 200);
  const search = await json(await call(searchRoute.GET, ctx.clientToken, "/api/search?q=report"));
  assert.deepEqual(search.body.results.filter((result) => result.type === "document").map((result) => result.id).sort(), [ctx.facingDoc.id, ctx.accountDoc.id].sort());
  const taskSearch = await json(await call(searchRoute.GET, ctx.clientToken, "/api/search?q=review"));
  assert.equal(taskSearch.body.results.some((result) => result.id === ctx.internal.id), false);
});

test("client activity is limited to the allowlist and loses staff meta", async () => {
  const ctx = await setup();
  await ctx.store.addActivity({ clientId: ctx.client.id, actorId: "admin", actorName: "Admin", action: "task.updated", meta: { taskId: ctx.facing.id, patch: { status: "in_progress", internalNotes: "SECRET-NOTE" } } });
  await ctx.store.addActivity({ clientId: ctx.client.id, actorId: "admin", actorName: "Admin", action: "task.updated", meta: { taskId: ctx.internal.id, patch: { status: "blocked" } } });
  await ctx.store.addActivity({ clientId: ctx.client.id, actorId: "admin", actorName: "Admin", action: "task.progress_validated", meta: { taskId: ctx.facing.id, evidence: ["commit"] } });
  await ctx.store.addActivity({ clientId: ctx.client.id, actorId: "admin", actorName: "Admin", action: "client.updated", meta: { patch: { status: "on_hold" } } });
  const result = await json(await call(activityRoute.GET, ctx.clientToken, `/api/activity?clientId=${ctx.client.id}`));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.activity.map((entry) => [entry.action, entry.meta]), [["task.updated", { taskId: ctx.facing.id, status: "in_progress" }]]);
  const staff = await json(await call(activityRoute.GET, ctx.adminToken, `/api/activity?clientId=${ctx.client.id}`));
  assert.equal(staff.body.activity.length >= 4, true);
  assert.ok(CLIENT_VISIBLE_ACTIVITY["task.comment"]);
});

test("nobody reviews their own approval, and a client reviews only staff requests", async () => {
  const ctx = await setup();
  const own = await json(await call(opsRoute.POST, ctx.clientToken, "/api/project-operations", { method: "POST", body: { action: "approval", clientId: ctx.client.id, subject: "Approve my own thing" } }));
  assert.equal(own.status, 200);
  const selfReview = await json(await call(opsRoute.POST, ctx.clientToken, "/api/project-operations", { method: "POST", body: { action: "approval-review", approvalId: own.body.approval.id, status: "approved" } }));
  assert.equal(selfReview.status, 403);
  assert.equal(selfReview.body.error, "You cannot review an approval you requested");

  const staffRequest = await json(await call(opsRoute.POST, ctx.adminToken, "/api/project-operations", { method: "POST", body: { action: "approval", clientId: ctx.client.id, subject: "Approve the design" } }));
  assert.equal((await call(opsRoute.POST, ctx.adminToken, "/api/project-operations", { method: "POST", body: { action: "approval-review", approvalId: staffRequest.body.approval.id, status: "approved" } })).status, 403);
  const clientReview = await json(await call(opsRoute.POST, ctx.clientToken, "/api/project-operations", { method: "POST", body: { action: "approval-review", approvalId: staffRequest.body.approval.id, status: "approved" } }));
  assert.equal(clientReview.status, 200);
  assert.equal(clientReview.body.approval.status, "approved");

  assert.equal(approvalReviewError({ requestedBy: "a" }, { uid: "b", role: "client" }, "client"), "Clients can only review approvals requested by your team");
  assert.equal(approvalReviewError({ requestedBy: "a" }, { uid: "b", role: "client" }, null), "Clients can only review approvals requested by your team");
  assert.equal(approvalReviewError({ requestedBy: "a" }, { uid: "b", role: "team" }, "client"), null);
});

test("client updates are validated: status, pipeline stage, assignee, lengths and email", async () => {
  const ctx = await setup();
  const patch = (body) => call(clientRoute.PATCH, ctx.adminToken, `/api/clients/${ctx.client.id}`, { method: "PATCH", body, params: { id: ctx.client.id } }).then(json);
  const banana = await patch({ status: "banana" });
  assert.equal(banana.status, 400);
  assert.match(banana.body.error, /status must be one of/);
  assert.equal((await ctx.store.getClient(ctx.client.id)).status, ctx.client.status, "nothing was saved");
  assert.equal((await patch({ pipelineStage: "moon" })).status, 400);
  assert.equal((await patch({ primaryContactEmail: "not-an-email" })).status, 400);
  assert.equal((await patch({ name: "x".repeat(256) })).status, 400);
  assert.equal((await patch({ tags: ["x".repeat(51)] })).status, 400);
  assert.equal((await patch({ customFields: { note: "x".repeat(2001) } })).status, 400);
  assert.equal((await patch({ assignedTeamMemberId: "client-user" })).status, 400, "a client user is not staff");
  assert.equal((await patch({ assignedTeamMemberId: "ghost" })).status, 400);
  const ok = await patch({ status: "on_hold", pipelineStage: "kyc", tags: [" a ", "a", "b"], assignedTeamMemberId: "admin" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.client.tags, ["a", "b"]);
  assert.equal(ok.body.client.pipelineStage, "kyc");

  const bulk = await json(await call(bulkRoute.POST, ctx.adminToken, "/api/clients/bulk", { method: "POST", body: { ids: [ctx.client.id], status: "banana" } }));
  assert.equal(bulk.status, 400);
  const create = await json(await call(clientsRoute.POST, ctx.adminToken, "/api/clients", { method: "POST", body: { name: "N", companyName: "C", primaryContactEmail: "c@c.test", status: "banana" } }));
  assert.equal(create.status, 400);

  await ctx.store.upsertUser({ uid: "gone", email: "gone@example.com", name: "Gone", role: "team", clientId: null, createdAt: now(), status: "deactivated" });
  assert.equal(isActiveStaffUser(await ctx.store.getUser("gone")), false);
  assert.equal(parseClientInput(clientUpdateSchema, { status: "banana" }).ok, false);
  assert.equal(parseClientInput(clientCreateSchema, { name: "N", companyName: "C", primaryContactEmail: "C@C.TEST" }).data.primaryContactEmail, "c@c.test");
});

test("the Hodi queue is staff-only and reading never refreshes it", async () => {
  const ctx = await setup();
  assert.equal((await call(queueRoute.GET, ctx.clientToken, "/api/hodi/queue")).status, 403);
  assert.equal((await call(queueRoute.GET, ctx.clientToken, "/api/hodi/queue?refresh=1")).status, 403);
  assert.equal((await call(queueRoute.POST, ctx.clientToken, "/api/hodi/queue", { method: "POST", body: {} })).status, 403);
  assert.equal((await call(queueItemRoute.GET, ctx.clientToken, "/api/hodi/queue/x", { params: { id: "x" } })).status, 403);
  assert.equal((await call(queueItemRoute.PATCH, ctx.clientToken, "/api/hodi/queue/x", { method: "PATCH", body: { status: "completed" }, params: { id: "x" } })).status, 403);
  assert.equal((await call(queueRoute.GET, ctx.adminToken, "/api/hodi/queue?refresh=1")).status, 400);
  assert.equal((await call(queueRoute.GET, ctx.adminToken, "/api/hodi/queue")).status, 200);
});

test("filterAssignedClients gives a client session only its own client", async () => {
  const clients = [{ id: "a", assignedTeamMemberId: "t" }, { id: "b", assignedTeamMemberId: null }];
  assert.deepEqual(await filterAssignedClients({ uid: "c", role: "client", clientId: "a" }, clients), [clients[0]]);
  assert.deepEqual(await filterAssignedClients({ uid: "c", role: "client", clientId: null }, clients), []);
  assert.deepEqual(await filterAssignedClients({ uid: "x", role: "admin", clientId: null }, clients), clients);
});

test("projection helpers", () => {
  const task = { id: "t", type: "client_facing", internalNotes: "n", watcherIds: ["w"], escalatedAt: "e", reminderSentAt: "r", metadata: {}, title: "T" };
  assert.deepEqual(clientSafeTask(task), { id: "t", type: "client_facing", title: "T" });
  const tasks = new Map([["t", { type: "client_facing" }], ["i", { type: "internal" }]]);
  assert.equal(clientCanSeeDocument({ taskId: null }, tasks), true);
  assert.equal(clientCanSeeDocument({ taskId: "i" }, tasks), false);
  assert.equal(clientCanSeeDocument({ taskId: "deleted" }, tasks), false);
  const docs = new Map([["d", { taskId: "i" }]]);
  assert.deepEqual(clientSafeActivity([{ id: "1", clientId: "c", actorId: "a", actorName: "A", action: "document.reviewed", timestamp: "", meta: { documentId: "d", status: "approved" } }], tasks, docs), []);
});
