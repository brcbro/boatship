import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests, isHostedStore } from "../lib/firestore/index.ts";
import { withRequestStoreScope } from "../lib/store-context.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, readSnapshotSlice, resetSnapshotCache } = await import("../lib/store.ts");
const { clearSessionCache } = await import("../lib/session-cache.ts");
const { consumeRateLimit } = await import("../lib/rate-limit.ts");
const { createDatabaseSession, verifyIdToken, revokeOtherDatabaseSessions, listDatabaseSessions } = await import("../lib/auth.ts");
const { ENGAGEMENTS } = await import("../lib/engagements.ts");

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  clearSessionCache();
  return db;
}

/** Counts slice fetches so the tests can show when the cache is used. */
function countingDb() {
  const db = fresh();
  const counts = { getMany: 0, query: 0 };
  const getMany = db.getMany.bind(db);
  const query = db.query.bind(db);
  db.getMany = async (collection, ids) => { if (collection === "StoreSnapshot") counts.getMany += 1; return getMany(collection, ids); };
  db.query = async (spec) => { if (spec.collection === "StoreSnapshot") counts.query += 1; return query(spec); };
  return { db, counts };
}

test("the snapshot is cached per instance by meta version and refreshed only for changed slices", async () => {
  const { db, counts } = countingDb();
  const client = await withRequestStoreScope(async () => (await getStore()).createClient({ name: "Cache", companyName: "Cache Co", primaryContactEmail: "c@example.com", templateId: null, assignedTeamMemberId: null }));
  const after = { ...counts };
  // A later request with nothing committed in between reads only the meta document.
  const again = await withRequestStoreScope(async () => (await getStore()).getClient(client.id));
  assert.equal(again?.name, "Cache");
  assert.deepEqual(counts, after, "no slice fetch while the meta version is unchanged");
  assert.equal((await readSnapshotSlice("clients")).length, 1);
  assert.deepEqual(counts, after, "slice reads come from the cache too");

  // A write from another instance (direct to the collection) bumps the version, and only that slice is fetched.
  const meta = await db.get("StoreSnapshot", "main");
  const version = meta.data.version + 1;
  const tasks = JSON.stringify([{ id: "t_external", clientId: client.id, title: "External", status: "todo", order: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  await db.commit([
    { set: { collection: "StoreSnapshot", id: "main:tasks", data: { json: tasks, version } } },
    { set: { collection: "StoreSnapshot", id: "main", data: { version, updatedAt: new Date().toISOString() } } },
  ]);
  const seen = await withRequestStoreScope(async () => (await getStore()).listTasks(client.id));
  assert.equal(seen.map((task) => task.id).join(","), "t_external");
  assert.equal(counts.getMany, after.getMany, "the full slice set is not reloaded");
  assert.equal(counts.query, after.query + 1, "one query fetches the slices written since the cached version");
  // Mutating what a request returned never leaks into the next request.
  seen[0].title = "Changed locally";
  const fresh2 = await withRequestStoreScope(async () => (await getStore()).listTasks(client.id));
  assert.equal(fresh2[0].title, "External");
});

test("verified sessions are memoised briefly and dropped when the user or session changes", async () => {
  fresh();
  const store = await getStore();
  await store.upsertUser({ uid: "m1", email: "m@example.com", name: "M", role: "team", clientId: null, createdAt: new Date().toISOString(), permissions: ["clients.view"] });
  const token = await createDatabaseSession({ uid: "m1", email: "m@example.com", name: "M", role: "team", clientId: null, permissions: ["clients.view"] });
  assert.equal((await verifyIdToken(token))?.role, "team");
  await store.upsertUser({ uid: "m1", email: "m@example.com", name: "M", role: "admin", clientId: null, createdAt: new Date().toISOString(), permissions: [] });
  assert.equal((await verifyIdToken(token))?.role, "admin", "a user change is visible on the next verification");
  const { revokeDatabaseSession } = await import("../lib/auth.ts");
  await revokeDatabaseSession(token);
  assert.equal(await verifyIdToken(token), null, "a revoked session is not served from the memo");
});

test("the hosted store persists slices with a version and reads them back fresh per request", async () => {
  const db = fresh();
  assert.equal(isHostedStore(), true);
  const client = await withRequestStoreScope(async () => (await getStore()).createClient({ name: "Harbour", companyName: "Harbour Studio", primaryContactEmail: "h@example.com", templateId: null, assignedTeamMemberId: "team_1" }));
  assert.ok(client.id);
  const meta = await db.get("StoreSnapshot", "main");
  assert.ok(meta.data.version >= 1);
  const clients = await readSnapshotSlice("clients");
  assert.equal(clients.length, 1);
  assert.equal(clients[0].name, "Harbour");
  const engagement = await ENGAGEMENTS.get(`onboarding_${client.id}`);
  assert.equal(engagement?.clientId, client.id, "legacy engagement is created alongside the client");
  const again = await withRequestStoreScope(async () => (await getStore()).getClient(client.id));
  assert.equal(again?.companyName, "Harbour Studio");
});

test("concurrent mutations serialize through transactions and keep every write", async () => {
  fresh();
  const store = await getStore();
  const client = await store.createClient({ name: "Race", companyName: "Race Co", primaryContactEmail: "r@example.com", templateId: null, assignedTeamMemberId: null });
  await Promise.all(Array.from({ length: 6 }, (_, index) => withRequestStoreScope(async () => (await getStore()).addActivity({ clientId: client.id, actorId: "u", actorName: "U", action: `step.${index}`, meta: {} }))));
  const activity = await readSnapshotSlice("activity");
  assert.equal(activity.filter((entry) => entry.clientId === client.id && entry.action.startsWith("step.")).length, 6);
});

test("user profiles and notifications live in their own collections with snapshot fallback", async () => {
  const db = fresh();
  const store = await getStore();
  await store.upsertUser({ uid: "u1", email: "Ada@Example.com", name: "Ada", role: "team", clientId: null, createdAt: new Date().toISOString(), permissions: ["clients.view"] });
  assert.equal((await db.get("UserProfile", "u1")).data.email, "ada@example.com");
  assert.equal((await store.getUserByEmail("ADA@example.com"))?.uid, "u1");
  assert.equal((await store.listUsers()).map((user) => user.uid).join(","), "u1");
  const note = await store.createNotification({ userId: "u1", kind: "task_assigned", title: "Hi", body: "There", href: null, clientId: null });
  assert.equal((await store.listNotifications("u1")).length, 1);
  const read = await store.markNotificationRead(note.id, "u1");
  assert.ok(read.readAt);
  await store.createNotification({ userId: "u1", kind: "task_assigned", title: "Two", body: "B", href: null, clientId: null });
  assert.equal(await store.markAllNotificationsRead("u1"), 1);
  assert.ok((await store.listNotifications("u1")).every((item) => item.readAt));
  await store.deleteUser("u1");
  assert.equal(await db.get("UserProfile", "u1"), null);
  assert.equal((await db.query({ collection: "NotificationRecord" })).length, 0);
});

test("sessions are keyed by token hash and rate limits count atomically", async () => {
  fresh();
  const store = await getStore();
  await store.upsertUser({ uid: "s1", email: "s@example.com", name: "S", role: "admin", clientId: null, createdAt: new Date().toISOString(), permissions: [] });
  const session = { uid: "s1", email: "s@example.com", name: "S", role: "admin", clientId: null, permissions: [] };
  const token = await createDatabaseSession(session);
  const other = await createDatabaseSession(session);
  assert.equal((await verifyIdToken(token))?.uid, "s1");
  assert.equal((await listDatabaseSessions("s1")).length, 2);
  const { createHash } = await import("node:crypto");
  assert.equal(await revokeOtherDatabaseSessions("s1", createHash("sha256").update(token).digest("hex")), 1);
  assert.equal(await verifyIdToken(other), null);
  assert.equal((await verifyIdToken(token))?.uid, "s1");

  const results = await Promise.all(Array.from({ length: 5 }, () => consumeRateLimit({ scope: "t", identity: "same", max: 3, windowSeconds: 60 })));
  assert.deepEqual(results.filter(Boolean).length, 3);
});
