import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalQa, QA_PASSWORD } from "../scripts/lib/local-qa.mjs";
import { assertTestDatabaseTarget, testDatabaseUrl } from "../lib/firestore/test-database.ts";

function loopbackUrl(value, protocols = ["http:"]) {
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol), "QA requests require an approved local protocol");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "QA must never contact a remote host");
  assert.equal(url.username, "", "QA HTTP URLs must not contain credentials");
  assert.equal(url.password, "", "QA HTTP URLs must not contain credentials");
  return url;
}

// The PostgreSQL leg creates and drops a scratch table: it takes TEST_DATABASE_URL
// (never DATABASE_URL) and refuses remote hosts unless QA_ALLOW_REMOTE_DATABASE=1.
{
  const target = testDatabaseUrl();
  if (target) process.env.QA_DATABASE_URL = target;
  else if (process.env.QA_DATABASE_URL?.trim()) assertTestDatabaseTarget(process.env.QA_DATABASE_URL.trim());
}

const override = process.env.BOATSHIP_QA_URL ? loopbackUrl(process.env.BOATSHIP_QA_URL) : null;
const base = override || loopbackUrl("http://127.0.0.1:3100");
const runId = randomUUID();
const grants = ["clients.view", "clients.manage", "documents.review", "forms.review", "integrations.manage"];

function disableProviders() {
  const previous = new Map();
  for (const key of Object.keys(process.env)) {
    if (/COMPOSIO|OPENROUTER|OPENAI|AI_GATEWAY|RESEND|ZEPTOMAIL|UPSTASH|REDIS|WEBHOOK_ALLOWED_ORIGINS|BOATSHIP_SECRETS_MASTER_KEY/.test(key)) {
      previous.set(key, process.env[key]);
      process.env[key] = "";
    }
  }
  return () => { for (const [key, value] of previous) process.env[key] = value; };
}

async function request(path, { token, method = "GET", body, headers = {}, binary = false } = {}) {
  const url = loopbackUrl(new URL(path, base).href);
  assert.equal(url.origin, base.origin, "Every QA API request must stay on its selected local server");
  const response = await fetch(url, {
    method, redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null);
  return { response, data };
}

async function api(path, options, status = 200) {
  const result = await request(path, options);
  assert.equal(result.response.status, status, `${options?.method || "GET"} ${path}: ${typeof result.data?.error === "string" ? result.data.error : "unexpected HTTP status"}`);
  return result;
}

async function waitForServer(child) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (child && child.exitCode !== null) throw new Error("The isolated QA web process exited before it was ready");
    try {
      const response = await fetch(new URL("/api/health", base), { redirect: "error", signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* The local process may still be starting. */ }
    await delay(200);
  }
  throw new Error("The local QA server did not become ready");
}

test("isolated migration, authorization and client delivery flows", { timeout: 600_000 }, async (t) => {
  const restoreProviders = disableProviders();
  const qa = await createLocalQa({ web: !override, port: Number(base.port || 3100) });
  const preservedEnvironment = new Map(["FIRESTORE_EMULATOR_HOST", "FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT", "FIREBASE_STORAGE_BUCKET", "DATABASE_URL", "DATABASE_TABLE", "ALLOW_LOCAL_STORE", "NODE_ENV"].map((key) => [key, process.env[key]]));
  t.after(async () => {
    await qa.close();
    for (const [key, value] of preservedEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    restoreProviders();
  });

  await t.test("the database fixture holds file bytes as content records and references in the snapshot", async () => {
    const contents = await qa.firestore.getMany("DocumentContent", ["legacy:qa_document:current", "legacy:qa_document:version:0"]);
    assert.equal(contents.size, 2);
    const current = contents.get("legacy:qa_document:current").data;
    const historical = contents.get("legacy:qa_document:version:0").data;
    assert.deepEqual(Buffer.from(current.bytes), qa.currentBytes);
    assert.deepEqual(Buffer.from(historical.bytes), qa.oldBytes);
    assert.equal(current.size, qa.currentBytes.length);
    assert.equal(historical.size, qa.oldBytes.length);
    const meta = await qa.firestore.get("StoreSnapshot", "main");
    assert.equal(meta.data.version, 1);
    const documents = JSON.parse((await qa.firestore.get("StoreSnapshot", "main:documents")).data.json);
    assert.equal(Object.hasOwn(documents[0], "contentBase64") && documents[0].contentBase64 !== null, false);
    assert.equal(documents[0].contentId, "legacy:qa_document:current");
    assert.equal(documents[0].versions[0].contentId, "legacy:qa_document:version:0");
  });

  await waitForServer(qa.child);
  const sessions = {};
  for (const [name, email] of [["admin", "admin@qa.invalid"], ["viewer", "viewer@qa.invalid"], ["client", "client@qa.invalid"], ["other", "other@qa.invalid"], ["none", "none@qa.invalid"]]) {
    const login = await api("/api/auth/login", { method: "POST", body: { email, password: QA_PASSWORD } });
    assert.ok(login.data.token);
    assert.match(login.response.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(login.response.headers.get("set-cookie"), /SameSite=Lax/i);
    sessions[name] = login.data.token;
  }
  const fixture = await api("/api/project-operations?clientId=qa_client", { token: sessions.admin });
  assert.equal(fixture.data.workspace.slug, "qa", "HTTP mutations require the isolated QA fixture marker");
  await t.test("cookie sessions allow same-origin logout and reject cross-site mutations", async () => {
    const login = await api("/api/auth/login", { method: "POST", body: { email: "none@qa.invalid", password: QA_PASSWORD } });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    assert.equal((await api("/api/account", { headers: { cookie } })).data.user.uid, "qa_none");
    await api("/api/auth/logout", { method: "POST", body: {}, headers: { cookie, origin: "https://blocked.qa.invalid" } }, 403);
    await api("/api/account", { headers: { cookie } });
    const logout = await api("/api/auth/logout", { method: "POST", body: {}, headers: { cookie, origin: base.origin } });
    assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
    await api("/api/account", { headers: { cookie } }, 401);
  });
  await api("/api/clients/qa_other", { token: sessions.admin, method: "PATCH", body: { assignedTeamMemberId: "qa_viewer" } });
  const permissions = async (value) => api("/api/users", { token: sessions.admin, method: "PATCH", body: { uid: "qa_viewer", permissions: value } });
  t.after(async () => {
    await permissions(["clients.view"]).catch(() => {});
    await api("/api/clients/qa_other", { token: sessions.admin, method: "PATCH", body: { assignedTeamMemberId: "qa_other_team" } }).catch(() => {});
  });
  const upload = (clientId, fileName, bytes = qa.currentBytes, context = {}) => ({ clientId, fileName, contentType: "image/png", size: bytes.length, base64: bytes.toString("base64"), ...context });
  let ownDocument;
  let activeEngagement;
  let otherEngagement;
  let closedDocument;
  let closedForm;

  await t.test("login and ownership checks reject invalid credentials and unrelated resources", async () => {
    await api("/api/auth/login", { method: "POST", body: { email: "viewer@qa.invalid", password: "Incorrect-QA-password" } }, 401);
    await api("/api/clients/qa_client", { token: sessions.viewer }, 403);
    await api("/api/documents/qa_document/content", { token: sessions.other }, 403);
    await api("/api/forms/qa_form/submit", { token: sessions.other, method: "POST", body: { responses: { email: "safe@qa.invalid", choice: "Website" } } }, 403);
    await api("/api/documents/upload", { token: sessions.client, method: "POST", body: upload("qa_other", "forbidden.png") }, 403);
    await api("/api/clients", { token: sessions.none }, 403);
    await api("/api/account", { token: sessions.none });
  });

  await t.test("empty permissions deny all capabilities and changes apply to the existing token", async () => {
    await permissions([]);
    for (const path of ["/api/clients", "/api/analytics", "/api/integrations/jobs", "/api/documents?clientId=qa_other"]) await api(path, { token: sessions.viewer }, 403);
    await api("/api/account", { token: sessions.viewer });
    await api("/api/users", { token: sessions.admin, method: "PATCH", body: { uid: "qa_viewer", permissions: ["clients.view", "unknown.manage"] } }, 400);
    const users = await api("/api/users", { token: sessions.admin });
    assert.deepEqual(users.data.users.find((user) => user.uid === "qa_viewer").permissions, []);
    await permissions(grants);
    const client = await api("/api/clients/qa_other", { token: sessions.viewer });
    assert.equal(client.data.client.id, "qa_other");
    const uploaded = await api("/api/documents/upload", { token: sessions.viewer, method: "POST", body: upload("qa_other", `own-${runId}.png`) });
    ownDocument = uploaded.data.document;
    await permissions(["clients.view", "clients.manage"]);
    await api(`/api/documents/${ownDocument.id}`, { token: sessions.viewer, method: "PATCH", body: { status: "pending_review", reviewNote: "must be denied" } }, 403);
    await permissions(["documents.review"]);
    await api(`/api/documents/${ownDocument.id}/content`, { token: sessions.viewer });
    await api(`/api/documents/${ownDocument.id}`, { token: sessions.viewer, method: "PATCH", body: { status: "pending_review", reviewNote: "authorized review" } });
    await api("/api/clients/qa_other", { token: sessions.viewer }, 403);
    await permissions(grants);
  });

  await t.test("uploads validate bytes, type, size, task and engagement before creating records", async () => {
    const before = (await api("/api/documents?clientId=qa_other", { token: sessions.admin })).data.documents.length;
    for (const body of [
      { ...upload("qa_other", "invalid.png"), base64: "invalid-base64" },
      { ...upload("qa_other", "wrong-type.pdf"), contentType: "application/pdf" },
      { ...upload("qa_other", "wrong-size.png"), size: 1 },
      upload("qa_other", "bad\nname.png"),
      upload("qa_other", "bad-task.png", qa.currentBytes, { taskId: "qa_task" }),
      upload("qa_other", "bad-engagement.png", qa.currentBytes, { engagementId: "qa_active" }),
    ]) await api("/api/documents/upload", { token: sessions.admin, method: "POST", body }, 400);
    const after = (await api("/api/documents?clientId=qa_other", { token: sessions.admin })).data.documents.length;
    assert.equal(after, before);
    await api("/api/documents", { token: sessions.admin, method: "POST", body: { clientId: "qa_other", fileName: "fake.png", storagePath: "https://example.invalid/fake", contentType: "image/png", size: 1 } }, 400);
    await api(`/api/documents/${ownDocument.id}`, { token: sessions.admin, method: "PATCH", body: { fileName: "fake.png", storagePath: "https://example.invalid/fake", contentType: "image/png", size: 1 } }, 400);
  });

  await t.test("current and historical file downloads preserve bytes and secure range/MIME headers", async () => {
    for (const [path, bytes] of [["/api/documents/qa_document/content", qa.currentBytes], ["/api/documents/qa_document/content?version=0", qa.oldBytes]]) {
      const download = await api(path, { token: sessions.client, binary: true });
      assert.deepEqual(download.data, bytes);
      assert.equal(download.response.headers.get("content-type"), "image/png");
      assert.equal(download.response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(download.response.headers.get("cache-control"), "private, no-store");
      assert.match(download.response.headers.get("content-disposition"), /^inline;/);
      assert.match(download.response.headers.get("content-security-policy"), /sandbox/);
    }
    const attachment = await api("/api/documents/qa_document/content?disposition=attachment", { token: sessions.client, binary: true });
    assert.match(attachment.response.headers.get("content-disposition"), /^attachment;/);
    const range = await api("/api/documents/qa_document/content", { token: sessions.client, headers: { range: "bytes=0-15" }, binary: true }, 206);
    assert.deepEqual(range.data, qa.currentBytes.subarray(0, 16));
    assert.equal(range.response.headers.get("content-range"), `bytes 0-15/${qa.currentBytes.length}`);
    const invalidRange = await api("/api/documents/qa_document/content", { token: sessions.client, headers: { range: "bytes=999999999-" }, binary: true }, 416);
    assert.equal(invalidRange.response.headers.get("content-range"), `bytes */${qa.currentBytes.length}`);
    await api("/api/documents/qa_document/content?version=999", { token: sessions.client }, 400);
    const metadata = await api("/api/documents/qa_document", { token: sessions.client });
    assert.equal(Object.hasOwn(metadata.data.document, "contentBase64"), false);
    assert.equal(Object.hasOwn(metadata.data.document.versions[0], "contentBase64"), false);
  });

  await t.test("simultaneous replacements retain the original and both uploaded contents", async () => {
    const a = Buffer.concat([qa.oldBytes, Buffer.from("qa-replacement-a")]);
    const b = Buffer.concat([qa.oldBytes, Buffer.from("qa-replacement-b")]);
    const results = await Promise.all([a, b].map((bytes, index) => api("/api/documents/upload", { token: sessions.other, method: "POST", body: upload("qa_other", `replacement-${index}.png`, bytes, { documentId: ownDocument.id }) })));
    assert.equal(results.length, 2);
    const latest = (await api(`/api/documents/${ownDocument.id}`, { token: sessions.admin })).data.document;
    assert.equal(latest.versions.length, 2);
    const contents = [];
    for (const suffix of ["", "?version=0", "?version=1"]) contents.push((await api(`/api/documents/${ownDocument.id}/content${suffix}`, { token: sessions.other, binary: true })).data.toString("base64"));
    assert.deepEqual(contents.sort(), [qa.currentBytes, a, b].map((bytes) => bytes.toString("base64")).sort());
  });

  await t.test("engagement filters distinguish account-wide resources from engagement work", async () => {
    activeEngagement = (await api("/api/clients/qa_other/engagements", { token: sessions.admin, method: "POST", body: { name: `Active API ${runId}`, type: "project", ownerId: "qa_viewer" } })).data.engagement.id;
    otherEngagement = (await api("/api/clients/qa_other/engagements", { token: sessions.admin, method: "POST", body: { name: `Other API ${runId}`, type: "project", ownerId: "qa_viewer" } })).data.engagement.id;
    const a = (await api("/api/messages", { token: sessions.other, method: "POST", body: { clientId: "qa_other", engagementId: activeEngagement, body: "Active engagement message" } })).data.message;
    const account = (await api("/api/messages", { token: sessions.other, method: "POST", body: { clientId: "qa_other", body: "Account-wide message" } })).data.message;
    const selected = (await api(`/api/messages?clientId=qa_other&engagementId=${activeEngagement}`, { token: sessions.other })).data.messages;
    assert.ok(selected.some((item) => item.id === a.id));
    assert.equal(selected.some((item) => item.id === account.id), false);
    const included = (await api(`/api/messages?clientId=qa_other&engagementId=${activeEngagement}&includeAccountWide=1`, { token: sessions.other })).data.messages;
    assert.ok(included.some((item) => item.id === account.id));
    assert.equal((await api(`/api/messages?clientId=qa_other&engagementId=${otherEngagement}`, { token: sessions.other })).data.messages.some((item) => item.id === a.id), false);
    const scopedDoc = (await api("/api/documents/upload", { token: sessions.admin, method: "POST", body: upload("qa_other", "engagement.png", qa.oldBytes, { engagementId: activeEngagement }) })).data.document;
    const docs = (await api(`/api/documents?clientId=qa_other&engagementId=${activeEngagement}`, { token: sessions.other })).data.documents;
    assert.ok(docs.some((item) => item.id === scopedDoc.id));
    assert.equal(docs.some((item) => item.id === ownDocument.id), false);
    const milestone = (await api("/api/project-operations", { token: sessions.admin, method: "POST", body: { action: "milestone", clientId: "qa_other", engagementId: activeEngagement, title: "API milestone" } })).data.milestone;
    assert.ok((await api(`/api/project-operations?clientId=qa_other&engagementId=${activeEngagement}`, { token: sessions.other })).data.milestones.some((item) => item.id === milestone.id));
    assert.equal((await api(`/api/project-operations?clientId=qa_other&engagementId=${otherEngagement}`, { token: sessions.other })).data.milestones.some((item) => item.id === milestone.id), false);
    const privateOps = (await api("/api/project-operations?clientId=qa_client", { token: sessions.client })).data;
    assert.equal(privateOps.schedules.some((item) => item.id === "qa_private_schedule"), false);
    assert.equal(Object.hasOwn(privateOps, "workspace"), false);
    const task = (await api("/api/tasks", { token: sessions.admin, method: "POST", body: { clientId: "qa_other", engagementId: activeEngagement, title: "API form task", type: "client_facing", assignedRole: "client", formTemplateId: "qa_form_template" } })).data.task;
    const forms = (await api(`/api/forms?clientId=qa_other&engagementId=${activeEngagement}`, { token: sessions.other })).data.forms;
    closedForm = forms.find((form) => form.taskId === task.id);
    assert.ok(closedForm);
    assert.equal((await api(`/api/forms?clientId=qa_other&engagementId=${otherEngagement}`, { token: sessions.other })).data.forms.some((form) => form.id === closedForm.id), false);
    closedDocument = scopedDoc;
  });

  await t.test("invalid form answers do not mutate the form, and concurrent submission commits once", async () => {
    const task = (await api("/api/tasks", { token: sessions.admin, method: "POST", body: { clientId: "qa_other", engagementId: otherEngagement, title: `Isolated form ${runId}`, type: "client_facing", assignedRole: "client", formTemplateId: "qa_form_template" } })).data.task;
    const form = (await api(`/api/forms?clientId=qa_other&engagementId=${otherEngagement}`, { token: sessions.other })).data.forms.find((item) => item.taskId === task.id);
    assert.ok(form);
    for (const responses of [{ email: "not-an-email", choice: "Website" }, { email: "safe@qa.invalid", choice: "Invalid choice" }, { email: 42, choice: "Website" }, { email: "safe@qa.invalid", choice: "Website", unexpected: "injected" }]) {
      await api(`/api/forms/${form.id}/submit`, { token: sessions.other, method: "POST", body: { responses } }, 400);
    }
    const unchanged = (await api(`/api/forms?clientId=qa_other&engagementId=${otherEngagement}`, { token: sessions.other })).data.forms.find((item) => item.id === form.id);
    assert.equal(unchanged.status, "not_started");
    assert.deepEqual(unchanged.responses, {});
    const responses = { email: "valid@qa.invalid", choice: "Website" };
    const submitted = await Promise.all([1, 2].map(() => request(`/api/forms/${form.id}/submit`, { token: sessions.other, method: "POST", body: { responses, riskScore: 9999 } })));
    assert.deepEqual(submitted.map((item) => item.response.status).sort(), [200, 409]);
    const winner = submitted.find((item) => item.response.status === 200).data.form;
    assert.deepEqual(winner.responses, responses);
    assert.notEqual(winner.riskScore, 9999);
    const deliveries = (await api("/api/webhooks/qa_hook", { token: sessions.admin })).data.deliveries.filter((item) => item.event === "form.submitted" && item.payload.formId === form.id);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].state, "pending");
    const activity = (await api("/api/activity?clientId=qa_other", { token: sessions.admin })).data.activity || [];
    assert.equal(activity.filter((item) => item.action === "form.submitted" && item.meta?.formId === form.id).length, 1);
    await permissions(["clients.view", "clients.manage"]);
    await api(`/api/forms/${form.id}/review`, { token: sessions.viewer, method: "PATCH", body: {} }, 403);
    await permissions(grants);
  });

  await t.test("bulk review prevalidates every document and closed engagements reject writes", async () => {
    const before = (await api(`/api/documents/${ownDocument.id}`, { token: sessions.admin })).data.document;
    await api("/api/documents/bulk", { token: sessions.viewer, method: "POST", body: { ids: [ownDocument.id, "qa_document"], status: "approved", reviewNote: "must not partially commit" } }, 403);
    const after = (await api(`/api/documents/${ownDocument.id}`, { token: sessions.admin })).data.document;
    assert.equal(after.status, before.status);
    assert.equal(after.reviewNote, before.reviewNote);
    await api(`/api/engagements/${activeEngagement}`, { token: sessions.admin, method: "PATCH", body: { status: "completed" } });
    await api("/api/messages", { token: sessions.other, method: "POST", body: { clientId: "qa_other", engagementId: activeEngagement, body: "closed write" } }, 409);
    await api("/api/documents/upload", { token: sessions.other, method: "POST", body: upload("qa_other", "closed.png", qa.oldBytes, { documentId: closedDocument.id }) }, 409);
    await api(`/api/documents/${closedDocument.id}`, { token: sessions.viewer, method: "PATCH", body: { status: "pending_review", reviewNote: "closed review" } }, 409);
    await api(`/api/forms/${closedForm.id}/submit`, { token: sessions.other, method: "POST", body: { responses: { email: "valid@qa.invalid", choice: "Website" } } }, 409);
    await api(`/api/forms/${closedForm.id}/review`, { token: sessions.viewer, method: "PATCH", body: {} }, 409);
    await api("/api/project-operations", { token: sessions.admin, method: "POST", body: { action: "milestone", clientId: "qa_other", engagementId: activeEngagement, title: "closed milestone" } }, 409);
    await api("/api/documents/bulk", { token: sessions.viewer, method: "POST", body: { ids: [ownDocument.id, closedDocument.id], status: "approved" } }, 409);
    assert.equal((await api(`/api/documents/${ownDocument.id}`, { token: sessions.admin })).data.document.status, before.status);
    const read = await api(`/api/documents?clientId=qa_other&engagementId=${activeEngagement}`, { token: sessions.other });
    assert.ok(read.data.documents.some((item) => item.id === closedDocument.id));
  });

  await t.test("queued integrations persist, revoke safely and enforce status/retry ownership", async () => {
    await permissions(grants);
    const created = [];
    for (let index = 0; index < 6; index += 1) {
      const result = await api("/api/clients", { token: sessions.viewer, method: "POST", body: { name: `API queue ${index}`, companyName: `QA queue ${runId} ${index}`, primaryContactEmail: `queue-${index}@qa.invalid`, templateId: "qa_template", assignedTeamMemberId: "qa_viewer" } });
      assert.equal(result.data.integrationJobs.length, 2);
      assert.ok(result.data.integrationJobs.every((job) => job.status === "pending"));
      created.push(...result.data.integrationJobs.map((job) => job.id));
    }
    const listed = await api("/api/integrations/jobs", { token: sessions.viewer });
    assert.equal(listed.response.headers.get("cache-control"), "private, no-store");
    for (const id of created) {
      const job = listed.data.jobs.find((item) => item.id === id);
      assert.ok(job);
      for (const field of ["payload", "leaseToken", "leaseUntil", "result"]) assert.equal(Object.hasOwn(job, field), false);
    }
    await api("/api/integrations/jobs?clientId=qa_client", { token: sessions.viewer }, 403);
    await permissions([]);
    await api("/api/integrations/jobs", { token: sessions.viewer }, 403);
    await api("/api/integrations/jobs", { token: sessions.viewer, method: "POST", body: { id: created[0] } }, 403);
    await api("/api/internal/integration-drain", { method: "POST", body: {} }, 401);
    const drains = await Promise.all([1, 2].map(() => api("/api/internal/integration-drain", { method: "POST", body: {}, headers: { "x-boatship-cron-secret": "local-qa-only" } })));
    const claimed = drains.flatMap((item) => item.data.results).filter((item) => created.includes(item.id));
    assert.equal(claimed.length, created.length);
    assert.equal(new Set(claimed.map((item) => item.id)).size, created.length);
    assert.ok(claimed.every((item) => item.status === "failed" && item.recorded));
    const persisted = (await api("/api/integrations/jobs", { token: sessions.admin })).data.jobs;
    assert.ok(created.every((id) => persisted.some((item) => item.id === id && item.status === "failed" && item.attempts === 1)));
    await api("/api/integrations/jobs", { token: sessions.admin, method: "POST", body: { id: created[0] } });
    const retried = (await api("/api/integrations/jobs", { token: sessions.admin })).data.jobs.find((item) => item.id === created[0]);
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempts, 0);
    await api("/api/integrations/jobs", { token: sessions.admin, method: "POST", body: { id: created[0] } }, 409);
    await api("/api/internal/integration-drain", { method: "POST", body: {}, headers: { "x-boatship-cron-secret": "local-qa-only" } });
    await permissions(["integrations.manage"]);
    await api("/api/integrations/jobs", { token: sessions.viewer, method: "POST", body: { id: created[0] } });
    const visible = (await api("/api/integrations/jobs", { token: sessions.viewer })).data.jobs;
    assert.ok(visible.some((item) => item.id === created[0] && item.status === "pending"));
    await permissions([]);
    await api("/api/internal/integration-drain", { method: "POST", body: {}, headers: { "x-boatship-cron-secret": "local-qa-only" } });
    await permissions(grants);
  });

  await t.test("real database job helpers deduplicate, claim concurrently and recover expired final leases", async () => {
    if (qa.host) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(qa.host).hostname));
    Object.assign(process.env, qa.storeEnv, { ALLOW_LOCAL_STORE: "0", NODE_ENV: "development" });
    const { enqueueIntegrationEvent, drainIntegrationJobs, retryIntegrationJob } = await import("../lib/integration-jobs.ts");
    const event = { type: "task.completed", clientId: "qa_client", clientName: "Harbour", companyName: "Harbour Studio", taskTitle: "Synthetic denied event" };
    const first = await enqueueIntegrationEvent("qa_none", event, `sql:${runId}:0`);
    const duplicate = await enqueueIntegrationEvent("qa_none", event, `sql:${runId}:0`);
    assert.deepEqual(duplicate.map((item) => item.id), first.map((item) => item.id));
    const ids = [...first.map((item) => item.id)];
    for (let index = 1; index < 5; index += 1) ids.push(...(await enqueueIntegrationEvent("qa_none", event, `sql:${runId}:${index}`)).map((item) => item.id));
    const claimed = (await Promise.all([drainIntegrationJobs(2), drainIntegrationJobs(2)])).flatMap((item) => item.results).filter((item) => ids.includes(item.id));
    assert.equal(claimed.length, 4);
    assert.equal(new Set(claimed.map((item) => item.id)).size, 4);
    assert.ok(claimed.every((item) => item.status === "failed" && item.recorded));
    await drainIntegrationJobs(20);
    const terminal = [...(await qa.firestore.getMany("IntegrationJob", ids)).values()].map((doc) => doc.data);
    assert.equal(terminal.length, 5);
    assert.ok(terminal.every((item) => item.status === "failed" && item.attempts === 1));
    await qa.firestore.commit([{ update: { collection: "IntegrationJob", id: ids[0], data: { status: "processing", attempts: 10, leaseUntil: "2000-01-01T00:00:00.000Z", leaseToken: "expired-lease" } } }]);
    await drainIntegrationJobs(20);
    const exhausted = (await qa.firestore.get("IntegrationJob", ids[0])).data;
    assert.equal(exhausted.status, "failed");
    assert.equal(exhausted.attempts, 10);
    assert.equal(exhausted.leaseToken, null);
    assert.equal(exhausted.leaseUntil, null);
    const admin = { uid: "qa_admin", name: "QA admin", email: "admin@qa.invalid", role: "admin", clientId: null, permissions: [] };
    assert.equal(await retryIntegrationJob(admin, ids[0]), true);
    await drainIntegrationJobs(1);
    const retried = (await qa.firestore.get("IntegrationJob", ids[0])).data;
    assert.equal(retried.id, ids[0]);
    assert.equal(retried.status, "failed");
    assert.equal(retried.attempts, 1);
  });
});
