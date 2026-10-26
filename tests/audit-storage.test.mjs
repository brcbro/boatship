import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { PostgresFirestore, postgresTls, indexedExpression } from "../lib/firestore/postgres.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";
import { onCommittedWrites } from "../lib/firestore/types.ts";
import { ownedBytes } from "../lib/firestore/bytes.ts";
import { assertTestDatabaseTarget, testDatabaseUrl } from "../lib/firestore/test-database.ts";
import { bumpRedisCacheForCollections } from "../lib/redis-cache.ts";
import { memoryDocumentObjectStore } from "../lib/document-objects.ts";
import {
  applyRetention, pruneIntegrationRuns, pruneNotifications, pruneWebhookDeliveries, splitActivityOverflow,
  ACTIVITY_ARCHIVE_BATCH, ACTIVITY_SNAPSHOT_MAX, INTEGRATION_RUN_MAX, WEBHOOK_DELIVERY_MAX,
} from "../lib/store-retention.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, resetSnapshotCache, changedSliceWrites, sliceByteLimit, FIRESTORE_SLICE_LIMIT, POSTGRES_SLICE_LIMIT, ACTIVITY_ARCHIVE } = await import("../lib/store.ts");
const { withRequestStoreScope } = await import("../lib/store-context.ts");

const NOW = Date.parse("2026-10-26T00:00:00.000Z");
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();

test("only changed slices are size-checked, against the backend's limit", () => {
  const big = "x".repeat(FIRESTORE_SLICE_LIMIT + 10);
  const data = { users: [], clients: [], tasks: [], documents: [], formTemplates: [], forms: [], templates: [], activity: [{ id: "a", note: big }], taskComments: [], notifications: [], messages: [], vessels: [], webhooks: [], webhookDeliveries: [], integrationRuns: [], smartLists: [], agentChatMessages: [], agentChatSessions: [], projectOps: {} };
  const before = new Map([["main:activity", { id: "main:activity", data: { json: JSON.stringify(data.activity), version: 1 }, updateTime: "" }]]);
  data.clients.push({ id: "c1" });
  // The oversized but unchanged activity slice does not block the clients write.
  const writes = changedSliceWrites(before, data, 2, FIRESTORE_SLICE_LIMIT);
  assert.ok(writes.some((write) => write.set.id === "main:clients"));
  assert.ok(!writes.some((write) => write.set.id === "main:activity"));
  data.activity.push({ id: "b" });
  assert.throws(() => changedSliceWrites(before, data, 3, FIRESTORE_SLICE_LIMIT), /activity .* over the 900000 byte limit/);
  assert.doesNotThrow(() => changedSliceWrites(before, data, 3, POSTGRES_SLICE_LIMIT));
  assert.equal(sliceByteLimit(new MemoryFirestore()), FIRESTORE_SLICE_LIMIT);
  const postgres = new PostgresFirestore({ url: "postgresql://u:p@127.0.0.1:1/x?sslmode=disable", table: "unused" });
  assert.equal(sliceByteLimit(postgres), POSTGRES_SLICE_LIMIT);
});

test("webhook deliveries drop old finished entries, cap the rest, and keep pending work", () => {
  const rows = [
    { id: "old-ok", state: "succeeded", createdAt: daysAgo(40) },
    { id: "old-failed", state: "failed", createdAt: daysAgo(40) },
    { id: "old-legacy", createdAt: daysAgo(40) },
    { id: "old-pending", state: "pending", createdAt: daysAgo(40) },
    { id: "old-leased", state: "leased", createdAt: daysAgo(40) },
    { id: "new-ok", state: "succeeded", createdAt: daysAgo(1) },
  ];
  assert.deepEqual(pruneWebhookDeliveries(rows, NOW).map((row) => row.id), ["old-pending", "old-leased", "new-ok"]);
  const many = Array.from({ length: WEBHOOK_DELIVERY_MAX + 5 }, (_, index) => ({ id: `d${index}`, state: index < 3 ? "pending" : "succeeded", createdAt: new Date(NOW - (WEBHOOK_DELIVERY_MAX + 5 - index) * 1000).toISOString() }));
  const capped = pruneWebhookDeliveries(many, NOW);
  assert.equal(capped.length, WEBHOOK_DELIVERY_MAX);
  assert.ok(["d0", "d1", "d2"].every((id) => capped.some((row) => row.id === id)), "pending deliveries survive the cap");
  assert.ok(!capped.some((row) => row.id === "d3"), "the oldest finished delivery goes first");
});

test("integration runs keep the newest, notifications drop only old read ones", () => {
  const runs = Array.from({ length: INTEGRATION_RUN_MAX + 2 }, (_, index) => ({ id: `r${index}`, createdAt: new Date(NOW + index).toISOString() }));
  const kept = pruneIntegrationRuns(runs);
  assert.equal(kept.length, INTEGRATION_RUN_MAX);
  assert.equal(kept[0].id, "r2");
  const notes = [{ id: "unread-old", readAt: null, createdAt: daysAgo(90) }, { id: "read-old", readAt: daysAgo(31), createdAt: daysAgo(90) }, { id: "read-new", readAt: daysAgo(2), createdAt: daysAgo(90) }];
  assert.deepEqual(pruneNotifications(notes, NOW).map((note) => note.id), ["unread-old", "read-new"]);
});

test("activity overflow is split off oldest first, one batch at a time", () => {
  const activity = Array.from({ length: ACTIVITY_SNAPSHOT_MAX + ACTIVITY_ARCHIVE_BATCH + 50 }, (_, index) => ({ id: `a${index}`, clientId: "c", timestamp: new Date(NOW + index).toISOString(), meta: {} }));
  const { kept, archived } = splitActivityOverflow(activity);
  assert.equal(archived.length, ACTIVITY_ARCHIVE_BATCH);
  assert.equal(archived[0].id, "a0");
  assert.equal(kept.length, activity.length - ACTIVITY_ARCHIVE_BATCH);
  const local = { webhookDeliveries: [], integrationRuns: [], notifications: [], activity };
  assert.deepEqual(applyRetention(local, NOW, { archiveActivity: false }).archivedActivity, []);
  assert.equal(local.activity.length, activity.length, "the local demo keeps all activity");
});

test("hosted mutations archive activity overflow in the same transaction and can read it back", async () => {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  const store = await withRequestStoreScope(() => getStore());
  await store.listClients();
  const seeded = Array.from({ length: ACTIVITY_SNAPSHOT_MAX + 3 }, (_, index) => ({ id: `seed${index}`, clientId: "c", actorId: "u", actorName: "U", action: "x", timestamp: new Date(NOW + index).toISOString(), meta: {} }));
  await db.commit([{ set: { collection: "StoreSnapshot", id: "main:activity", data: { json: JSON.stringify(seeded), version: 99 } } }, { set: { collection: "StoreSnapshot", id: "main", data: { version: 99, updatedAt: "x" } } }]);
  resetSnapshotCache();
  const writer = await withRequestStoreScope(() => getStore());
  await writer.addActivity({ clientId: "c", actorId: "u", actorName: "U", action: "y", meta: {} });
  const archived = await ACTIVITY_ARCHIVE.find([]);
  assert.equal(archived.length, 4);
  assert.ok(archived.some((entry) => entry.id === "seed0"));
  const reader = await withRequestStoreScope(() => getStore());
  assert.equal((await reader.listAllActivity()).length, ACTIVITY_SNAPSHOT_MAX);
  assert.equal((await reader.listAllActivity({ includeArchived: true })).length, ACTIVITY_SNAPSHOT_MAX + 4);
  assert.equal((await reader.listActivity("c", { includeArchived: true })).length, ACTIVITY_SNAPSHOT_MAX + 4);
  setFirestoreForTests(null);
});

test("a snapshot version that goes backwards (a restore) drops the slice cache", async () => {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  const first = await withRequestStoreScope(() => getStore());
  await first.addActivity({ clientId: "c", actorId: "u", actorName: "U", action: "x", meta: {} });
  await first.createClient({ name: "Before", companyName: "Before Co", primaryContactEmail: "b@example.com", templateId: null, assignedTeamMemberId: null });
  assert.ok((await db.get("StoreSnapshot", "main")).data.version > 1);
  // Simulate restoring an older backup: version 1 and no clients.
  await db.commit([{ set: { collection: "StoreSnapshot", id: "main", data: { version: 1, updatedAt: "x" } } }, { set: { collection: "StoreSnapshot", id: "main:clients", data: { json: "[]", version: 1 } } }]);
  const after = await withRequestStoreScope(() => getStore());
  assert.deepEqual(await after.listClients(), []);
  setFirestoreForTests(null);
});

test("TLS: Hyperdrive stays plain, loopback may disable, a pinned CA verifies", () => {
  assert.equal(postgresTls("postgresql://u:p@abc.hyperdrive.local:5432/db", "PEM"), false);
  assert.equal(postgresTls("postgresql://u:p@127.0.0.1:5432/db?sslmode=disable"), false);
  assert.equal(postgresTls("postgresql://u:p@db.example.com:5432/db?sslmode=disable"), "require", "a remote host never drops TLS");
  assert.equal(postgresTls("postgresql://u:p@db.example.com:5432/db"), "require");
  assert.deepEqual(postgresTls("postgresql://u:p@db.example.com/db", "-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----"), { ca: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  assert.equal(indexedExpression("createdAt"), `((doc ->> 'createdAt') COLLATE "C")`);
  assert.throws(() => indexedExpression("name"));
});

test("database tests refuse remote targets unless explicitly allowed", () => {
  assert.equal(testDatabaseUrl({}), null);
  assert.equal(testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/t" }), "postgresql://u:p@localhost:5432/t");
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:secret@prod.example.com/db" }), (error) => /prod\.example\.com/.test(error.message) && !/secret/.test(error.message));
  assert.doesNotThrow(() => assertTestDatabaseTarget("postgresql://u:p@prod.example.com/db", { QA_ALLOW_REMOTE_DATABASE: "1" }));
  assert.throws(() => assertTestDatabaseTarget("not a url", {}));
});

test("committed writes to cached collections bump the Redis generation", async () => {
  const calls = [];
  const previous = { fetch: globalThis.fetch, url: process.env.REDIS_REST_URL, token: process.env.REDIS_REST_TOKEN };
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)[0]); return new Response(JSON.stringify([{ result: 1 }]), { status: 200 }); };
  process.env.REDIS_REST_URL = "https://redis.test";
  process.env.REDIS_REST_TOKEN = "t";
  try {
    assert.equal(await bumpRedisCacheForCollections(["Task"]), false);
    const db = new MemoryFirestore();
    const seen = [];
    const stop = onCommittedWrites((writes) => { seen.push(writes.length); });
    await db.commit([{ set: { collection: "Engagement", id: "e1", data: { name: "x" } } }]);
    await db.runTransaction(async (tx) => { tx.write({ set: { collection: "ClientContact", id: "k", data: {} } }); });
    await assert.rejects(db.runTransaction(async (tx) => { tx.write({ set: { collection: "UserProfile", id: "u", data: {} } }); throw new Error("rolled back"); }));
    stop();
    assert.deepEqual(seen, [1, 1], "rolled-back transactions are not reported");
    assert.equal(calls.filter((command) => command[0] === "INCR").length, 2);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.REDIS_REST_URL; else process.env.REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.REDIS_REST_TOKEN; else process.env.REDIS_REST_TOKEN = previous.token;
  }
});

test("byte views avoid copies but never expose pooled memory", async () => {
  const large = Buffer.alloc(100_000, 7);
  const view = ownedBytes(large);
  assert.equal(view.buffer, large.buffer, "an owning Buffer is shared, not copied");
  const pooled = Buffer.from("aGVsbG8=", "base64");
  const copy = ownedBytes(pooled);
  assert.deepEqual([...copy], [...Buffer.from("hello")]);
  assert.equal(copy.buffer.byteLength, copy.length);
  const objects = memoryDocumentObjectStore();
  await objects.put("k", Uint8Array.from({ length: 64 }, (_, index) => index), "image/png");
  const part = await objects.getRange("k", 10, 19);
  assert.equal(part.size, 64);
  assert.deepEqual([...part.bytes], Array.from({ length: 10 }, (_, index) => index + 10));
  assert.equal(part.head.length, 16);
});

test("ZeptoMail requests carry a timeout signal", async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.ZEPTOMAIL_API_KEY, from: process.env.ZEPTOMAIL_FROM };
  let signal = null;
  globalThis.fetch = async (url, init) => { signal = init.signal; return new Response(JSON.stringify({ request_id: "r" }), { status: 200 }); };
  process.env.ZEPTOMAIL_API_KEY = "test-only";
  process.env.ZEPTOMAIL_FROM = "noreply@example.com";
  try {
    const { sendEmail } = await import("../lib/email.ts");
    await sendEmail({ to: "a@example.com", subject: "s", html: "h" });
    assert.ok(signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["ZEPTOMAIL_API_KEY", previous.key], ["ZEPTOMAIL_FROM", previous.from]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
