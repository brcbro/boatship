import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, resetSnapshotCache } = await import("../lib/store.ts");
const { clearSessionCache } = await import("../lib/session-cache.ts");
const { createDatabaseSession, verifyIdToken, listDatabaseSessions, sessionPublicId } = await import("../lib/auth.ts");
const { ACCOUNT_AUDIT_EVENTS, ACCOUNT_REQUESTS, recordAccountAudit, applyAccountChange } = await import("../lib/accounts.ts");
const { hashPassword, verifyPassword } = await import("../lib/password.ts");
const { createProductWithOwner } = await import("../lib/product-persistence.ts");
const { requireStaffRequestPermissions } = await import("../lib/rbac.ts");
const sessionsById = await import("../app/api/account/sessions/[id]/route.ts");
const sessions = await import("../app/api/account/sessions/route.ts");
const preferences = await import("../app/api/account/preferences/route.ts");
const access = await import("../app/api/account/access/route.ts");
const securityEvents = await import("../app/api/account/security-events/route.ts");
const requests = await import("../app/api/account/requests/route.ts");
const { proxy } = await import("../proxy.ts");
const { NextRequest } = await import("next/server");

const ORIGIN = "https://app.example";

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  clearSessionCache();
  return db;
}

async function seedUser(uid, role, extra = {}) {
  const store = await getStore();
  const user = { uid, email: `${uid}@example.com`, name: uid, role, clientId: null, createdAt: new Date().toISOString(), passwordHash: hashPassword(`${uid}-password-1`), status: "active", authzVersion: 0, ...extra };
  await store.upsertUser(user);
  return user;
}

async function signIn(user) {
  const token = await createDatabaseSession({ uid: user.uid, email: user.email, name: user.name, role: user.role, clientId: user.clientId, permissions: user.permissions });
  return { token, cookie: `boatship_session=${encodeURIComponent(token)}` };
}

function request(path, { method = "GET", cookie, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  // Cookie-authenticated mutations must look same-origin, as the browser's would.
  if (method !== "GET") { headers.origin = ORIGIN; headers.referer = `${ORIGIN}/account`; }
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = (id) => ({ params: Promise.resolve({ id }) });
const json = async (response) => ({ status: response.status, body: await response.json() });

test("one own session is revoked by public id; other people's ids are not found and the current session signs out", async () => {
  fresh();
  const alice = await seedUser("alice", "team", { permissions: [] });
  const bob = await seedUser("bob", "team");
  const current = await signIn(alice);
  const other = await signIn(alice);
  const bobs = await signIn(bob);

  const listed = await json(await sessions.GET(request("/api/account/sessions", { cookie: current.cookie })));
  assert.equal(listed.body.sessions.length, 2);
  for (const entry of listed.body.sessions) assert.match(entry.id, /^ses_[0-9a-f]{32}$/, "ids are opaque");
  const otherId = listed.body.sessions.find((entry) => !entry.current).id;
  const currentId = listed.body.sessions.find((entry) => entry.current).id;
  const bobId = sessionPublicId((await listDatabaseSessions("bob"))[0]);

  // Unauthenticated and malformed requests reveal nothing.
  assert.equal((await sessionsById.DELETE(request(`/api/account/sessions/${otherId}`, { method: "DELETE" }), params(otherId))).status, 401);
  assert.equal((await sessionsById.DELETE(request("/api/account/sessions/x", { method: "DELETE", cookie: current.cookie }), params("x"))).status, 404);

  // Bob's session cannot be revoked by Alice, whatever id she sends.
  const cross = await json(await sessionsById.DELETE(request(`/api/account/sessions/${bobId}`, { method: "DELETE", cookie: current.cookie }), params(bobId)));
  assert.equal(cross.status, 404);
  assert.equal((await verifyIdToken(bobs.token))?.uid, "bob", "bob stays signed in");

  // Alice revokes her other session; hers continues.
  const revoked = await json(await sessionsById.DELETE(request(`/api/account/sessions/${otherId}`, { method: "DELETE", cookie: current.cookie }), params(otherId)));
  assert.deepEqual(revoked.body, { ok: true, signedOut: false });
  assert.equal(await verifyIdToken(other.token, { authoritative: true }), null);
  assert.equal((await verifyIdToken(current.token))?.uid, "alice");
  assert.equal((await sessionsById.DELETE(request(`/api/account/sessions/${otherId}`, { method: "DELETE", cookie: current.cookie }), params(otherId))).status, 404, "already gone");

  // Revoking the current session signs the person out and clears the cookie.
  const response = await sessionsById.DELETE(request(`/api/account/sessions/${currentId}`, { method: "DELETE", cookie: current.cookie }), params(currentId));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, signedOut: true });
  assert.match(response.headers.get("set-cookie") || "", /boatship_session=;.*Max-Age=0/i);
  assert.equal(await verifyIdToken(current.token, { authoritative: true }), null);
  assert.equal((await listDatabaseSessions("alice")).length, 0);
  const events = (await ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: "alice" }])).map((event) => event.action).sort();
  assert.deepEqual(events, ["session.revoked", "session.revoked.current"]);
  assert.equal((await listDatabaseSessions("bob")).length, 1);
});

test("preferences are allowlisted, validated, written only for the session's user and never clobber a credential change", async () => {
  fresh();
  const alice = await seedUser("alice", "client", { clientId: "client_a" });
  await seedUser("bob", "team");
  const { cookie } = await signIn(alice);
  const store = await getStore();

  assert.equal((await preferences.GET(request("/api/account/preferences"))).status, 401);
  const initial = await json(await preferences.GET(request("/api/account/preferences", { cookie })));
  assert.deepEqual(initial.body, { preferences: { timezone: null, hourCycle: null } });

  for (const body of [{ timezone: "Mars/Olympus" }, { hourCycle: "13h" }, { uid: "bob", timezone: "UTC" }, { name: "x" }, {}, [], "UTC"]) {
    const bad = await preferences.PATCH(request("/api/account/preferences", { method: "PATCH", cookie, body }));
    assert.equal(bad.status, 400, JSON.stringify(body));
  }

  // A password change lands between the page load and the save.
  await applyAccountChange({ uid: "alice", bumpAuthz: false, patch: () => ({ passwordHash: hashPassword("rotated-1") }) });
  const saved = await json(await preferences.PATCH(request("/api/account/preferences", { method: "PATCH", cookie, body: { timezone: "Asia/Kolkata", hourCycle: "24h" } })));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { preferences: { timezone: "Asia/Kolkata", hourCycle: "24h" } });
  const stored = await store.getUser("alice");
  assert.equal(stored.timezone, "Asia/Kolkata");
  assert.ok(verifyPassword("rotated-1", stored.passwordHash), "the newer credential survived the preference save");
  assert.equal((await store.getUser("bob")).timezone ?? null, null, "nobody else was touched");

  const cleared = await json(await preferences.PATCH(request("/api/account/preferences", { method: "PATCH", cookie, body: { timezone: null } })));
  assert.deepEqual(cleared.body, { preferences: { timezone: null, hourCycle: "24h" } });
});

test("the access summary explains each role from the session alone and loads only what the person may see", async () => {
  fresh();
  const admin = await seedUser("admin", "admin");
  const team = await seedUser("team", "team", { permissions: [] });
  const viewer = await seedUser("viewer", "team", { permissions: ["clients.view", "forms.review"] });
  const store = await getStore();
  const mine = await store.createClient({ name: "Mine", companyName: "Mine Ltd", primaryContactEmail: "m@example.com", templateId: null, assignedTeamMemberId: "team" });
  await store.createClient({ name: "Theirs", companyName: "Theirs Ltd", primaryContactEmail: "t@example.com", templateId: null, assignedTeamMemberId: "viewer" });
  const client = await seedUser("cara", "client", { clientId: mine.id });
  const product = await createProductWithOwner({ name: "Tug", description: "", type: "saas", stage: "idea" }, "team", "tug");

  assert.equal((await access.GET(request("/api/account/access"))).status, 401);

  const zero = (await json(await access.GET(request("/api/account/access", { cookie: (await signIn(team)).cookie })))).body.access;
  assert.equal(zero.role, "team");
  assert.equal(zero.permissionsExplicit, true);
  assert.deepEqual(zero.effective, []);
  assert.equal(zero.capabilities.flatMap((group) => group.capabilities).some((capability) => capability.granted), false);
  assert.deepEqual(zero.assignedClients.map((entry) => entry.id), [mine.id], "only the assigned client, not the list");
  assert.deepEqual(zero.products, [{ id: product.id, name: "Tug", role: "owner" }]);
  assert.equal(zero.organization, null);

  const some = (await json(await access.GET(request("/api/account/access", { cookie: (await signIn(viewer)).cookie })))).body.access;
  assert.deepEqual(some.effective, ["clients.view", "forms.review"]);
  assert.deepEqual(some.capabilities.flatMap((group) => group.capabilities).filter((capability) => capability.granted).map((capability) => capability.key), ["clients.view", "forms.review"]);
  assert.deepEqual(some.assignedClients.map((entry) => entry.name), ["Theirs"]);
  assert.deepEqual(some.products, []);

  const boss = (await json(await access.GET(request("/api/account/access", { cookie: (await signIn(admin)).cookie })))).body.access;
  assert.equal(boss.permissionsExplicit, null);
  assert.equal(boss.capabilities.flatMap((group) => group.capabilities).every((capability) => capability.granted), true);
  assert.equal(boss.assignedClients, null, "administrators are not scoped by assignment");

  const own = (await json(await access.GET(request("/api/account/access", { cookie: (await signIn(client)).cookie })))).body.access;
  assert.equal(own.role, "client");
  assert.deepEqual(own.capabilities, []);
  assert.equal(own.assignedClients, null);
  assert.equal(own.products, null);
  assert.deepEqual(own.organization, { id: mine.id, name: "Mine", companyName: "Mine Ltd", assignedTeamMemberName: "team" });
  assert.equal(JSON.stringify(own).includes("Theirs"), false, "another organization never appears");
});

test("security events are the person's own, sanitised and paginated by time", async () => {
  fresh();
  const alice = await seedUser("alice", "team");
  const bob = await seedUser("bob", "team");
  const admin = { uid: "root", role: "admin" };
  const stamps = [];
  for (let index = 0; index < 5; index += 1) {
    const event = await recordAccountAudit({ action: "credential.password.changed", actor: alice, targetUserId: "alice", metadata: { secretToken: "never", note: "n" } });
    stamps.push(event.createdAt);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await recordAccountAudit({ action: "staff.permissions.changed", actor: admin, targetUserId: "alice", reason: "admin's private note" });
  await recordAccountAudit({ action: "internal.only.action", actor: admin, targetUserId: "alice" });
  await recordAccountAudit({ action: "credential.password.changed", actor: bob, targetUserId: "bob" });
  const { cookie } = await signIn(alice);

  assert.equal((await securityEvents.GET(request("/api/account/security-events"))).status, 401);
  const first = (await json(await securityEvents.GET(request("/api/account/security-events?limit=3", { cookie })))).body;
  assert.equal(first.events.length, 2, "the unknown action in this page is hidden");
  assert.ok(first.nextBefore);
  assert.equal(first.events[0].label, "Capabilities changed");
  assert.equal(first.events[0].by, "administrator");
  assert.equal(JSON.stringify(first).includes("private note"), false, "reasons never leave the server");
  assert.equal(JSON.stringify(first).includes("never"), false);
  assert.equal(Object.keys(first.events[0]).sort().join(","), "action,by,createdAt,id,label,result");

  const seen = [...first.events];
  let before = first.nextBefore;
  while (before) {
    const page = (await json(await securityEvents.GET(request(`/api/account/security-events?limit=3&before=${encodeURIComponent(before)}`, { cookie })))).body;
    seen.push(...page.events);
    before = page.nextBefore;
  }
  assert.equal(seen.length, 6, "five own password changes plus the capability change; bob's event is absent");
  assert.equal(seen.every((event) => event.by !== "staff"), true);
  const times = seen.map((event) => event.createdAt);
  assert.deepEqual(times, [...times].sort().reverse(), "newest first across pages");
  assert.equal(new Set(seen.map((event) => event.id)).size, 6, "no duplicates across pages");
});

test("account requests are created for the session's user only, once per open kind, and listed only to their owner", async () => {
  fresh();
  const alice = await seedUser("alice", "client", { clientId: "client_a" });
  const bob = await seedUser("bob", "team", { permissions: [] });
  const a = await signIn(alice);
  const b = await signIn(bob);

  assert.equal((await requests.POST(request("/api/account/requests", { method: "POST", body: { kind: "export" } }))).status, 401);
  for (const body of [{}, { kind: "delete-everything" }, { kind: "export", reason: 42 }, { kind: "access", reason: "x".repeat(1001) }]) {
    assert.equal((await requests.POST(request("/api/account/requests", { method: "POST", cookie: a.cookie, body }))).status, 400, JSON.stringify(body));
  }

  // A body naming someone else is ignored: the request belongs to the session.
  const created = await json(await requests.POST(request("/api/account/requests", { method: "POST", cookie: a.cookie, body: { kind: "export", reason: "  please  ", userId: "bob", status: "approved" } })));
  assert.equal(created.status, 200);
  assert.equal(created.body.request.kind, "export");
  assert.equal(created.body.request.status, "open");
  assert.equal(created.body.request.reason, "please");
  assert.equal("decidedBy" in created.body.request, false, "reviewer identity is not part of the DTO");
  const stored = await ACCOUNT_REQUESTS.get(created.body.request.id);
  assert.equal(stored.userId, "alice");

  const duplicate = await json(await requests.POST(request("/api/account/requests", { method: "POST", cookie: a.cookie, body: { kind: "export" } })));
  assert.equal(duplicate.status, 409);
  assert.equal((await requests.POST(request("/api/account/requests", { method: "POST", cookie: a.cookie, body: { kind: "deactivation" } }))).status, 200, "a different kind is fine");
  assert.equal((await requests.POST(request("/api/account/requests", { method: "POST", cookie: b.cookie, body: { kind: "access", reason: "clients.view for Mine" } }))).status, 200);

  const alices = (await json(await requests.GET(request("/api/account/requests", { cookie: a.cookie })))).body.requests;
  assert.deepEqual(alices.map((entry) => entry.kind), ["deactivation", "export"]);
  const bobs = (await json(await requests.GET(request("/api/account/requests", { cookie: b.cookie })))).body.requests;
  assert.deepEqual(bobs.map((entry) => entry.kind), ["access"]);
  const audit = (await ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: "alice" }])).map((event) => event.action).sort();
  assert.deepEqual(audit, ["account.request.deactivation.created", "account.request.export.created"]);
});

test("a team member with no capabilities reaches every account endpoint, and the proxy covers the new section routes", async () => {
  const session = { uid: "t", email: "t@example.com", name: "T", role: "team", clientId: null, permissions: [] };
  for (const path of ["/api/account", "/api/account/sessions", "/api/account/sessions/ses_" + "0".repeat(32), "/api/account/access", "/api/account/security-events", "/api/account/preferences", "/api/account/requests"]) {
    for (const method of ["GET", "PATCH", "POST", "DELETE"]) {
      assert.doesNotThrow(() => requireStaffRequestPermissions(session, new Request(`${ORIGIN}${path}`, { method })), `${method} ${path}`);
    }
  }
  assert.throws(() => requireStaffRequestPermissions(session, new Request(`${ORIGIN}/api/clients`, { method: "GET" })), (response) => response.status === 403);

  const sections = ["", "/security", "/notifications", "/preferences", "/access", "/privacy"];
  const encode = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64url") + ".x";
  const staff = encode({ uid: "s", role: "team", email: "s@example.com", name: "S", clientId: null });
  const client = encode({ uid: "c", role: "client", email: "c@example.com", name: "C", clientId: "client_a" });
  for (const section of sections) {
    const anonymous = await proxy(new NextRequest(`${ORIGIN}/account${section}`));
    assert.equal(anonymous.headers.get("location"), `${ORIGIN}/login?next=${encodeURIComponent(`/account${section}`)}`, `anonymous /account${section} goes to login`);
    const anonymousPortal = await proxy(new NextRequest(`${ORIGIN}/portal/account${section}`));
    assert.match(anonymousPortal.headers.get("location") || "", /\/login\?next=/, `anonymous /portal/account${section} goes to login`);
    const clientInStaffShell = await proxy(new NextRequest(`${ORIGIN}/account${section}`, { headers: { cookie: `boatship_session=${client}` } }));
    assert.equal(clientInStaffShell.headers.get("location"), `${ORIGIN}/portal`, `client cannot open /account${section}`);
    const staffInPortal = await proxy(new NextRequest(`${ORIGIN}/portal/account${section}`, { headers: { cookie: `boatship_session=${staff}` } }));
    assert.equal(staffInPortal.headers.get("location"), `${ORIGIN}/dashboard`);
    const staffOwn = await proxy(new NextRequest(`${ORIGIN}/account${section}`, { headers: { cookie: `boatship_session=${staff}` } }));
    assert.equal(staffOwn.headers.get("location"), null, `staff may open /account${section}`);
  }
});
