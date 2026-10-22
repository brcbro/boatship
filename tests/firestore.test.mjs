import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { RestFirestore } from "../lib/firestore/client.ts";
import { FirestoreError } from "../lib/firestore/types.ts";
import { compareValues, encodeFields, decodeFields, fieldPath } from "../lib/firestore/codec.ts";

const emulator = process.env.FIRESTORE_EMULATOR_HOST?.trim();
const backends = [["memory", () => new MemoryFirestore()]];
if (emulator) backends.push(["emulator", () => new RestFirestore({ projectId: process.env.FIREBASE_PROJECT_ID || "demo-boatship", host: emulator.startsWith("http") ? emulator : `http://${emulator}` })]);

let run = 0;
const col = (name) => `${name}_${process.pid}_${Date.now()}_${run++}`;

test("codec round-trips every supported type and quotes field paths", () => {
  const data = { s: "héllo", i: 42, big: 2 ** 53, d: 1.5, b: true, n: null, t: new Date("2026-10-22T10:00:00.000Z"), bytes: Uint8Array.from([1, 2, 255]), arr: [1, "two", { three: 3 }], map: { nested: { deep: [true] } } };
  const decoded = decodeFields(encodeFields(data));
  assert.deepEqual(decoded, data);
  assert.deepEqual(encodeFields({ skipped: undefined, kept: 1 }), { kept: { integerValue: "1" } });
  assert.throws(() => encodeFields({ nested: [[1]] }), /arrays directly inside arrays/);
  assert.equal(fieldPath("plain.path"), "plain.path");
  assert.equal(fieldPath("with-dash.ok"), "`with-dash`.ok");
  assert.ok(compareValues(null, false) < 0 && compareValues(false, 0) < 0 && compareValues(1, "a") < 0 && compareValues("a", "b") < 0 && compareValues("b", "a") > 0);
});

for (const [label, make] of backends) {
  test(`${label}: documents, preconditions, queries, counts and transactions`, { timeout: 60_000 }, async () => {
    const db = make();
    const users = col("users");
    await db.commit([
      { set: { collection: users, id: "a", data: { name: "Ada", role: "admin", score: 10, tags: ["x", "y"], createdAt: "2026-01-01T00:00:00.000Z" } } },
      { set: { collection: users, id: "b", data: { name: "Bob", role: "team", score: 5, tags: ["y"], createdAt: "2026-01-02T00:00:00.000Z" } } },
      { set: { collection: users, id: "c", data: { name: "Cy", role: "team", score: 7, createdAt: "2026-01-03T00:00:00.000Z", snoozedUntil: null } } },
    ]);

    const a = await db.get(users, "a");
    assert.equal(a.data.name, "Ada");
    assert.ok(a.updateTime);
    assert.equal(await db.get(users, "missing"), null);
    const many = await db.getMany(users, ["a", "missing", "c"]);
    assert.deepEqual([...many.keys()].sort(), ["a", "c"]);

    // Equality, ordering, limits and missing-field exclusion.
    const team = await db.query({ collection: users, where: [{ field: "role", op: "==", value: "team" }], orderBy: [{ field: "score", direction: "desc" }] });
    assert.deepEqual(team.map((doc) => doc.id), ["c", "b"]);
    const ranged = await db.query({ collection: users, where: [{ field: "createdAt", op: ">=", value: "2026-01-02T00:00:00.000Z" }], orderBy: [{ field: "createdAt" }], limit: 1 });
    assert.deepEqual(ranged.map((doc) => doc.id), ["b"]);
    const withSnooze = await db.query({ collection: users, orderBy: [{ field: "snoozedUntil" }] });
    assert.deepEqual(withSnooze.map((doc) => doc.id), ["c"], "orderBy excludes documents without the field");
    assert.deepEqual((await db.query({ collection: users, where: [{ field: "snoozedUntil", op: "is-null" }] })).map((doc) => doc.id), ["c"]);
    assert.deepEqual((await db.query({ collection: users, where: [{ field: "tags", op: "array-contains", value: "x" }] })).map((doc) => doc.id), ["a"]);
    assert.deepEqual((await db.query({ collection: users, where: [{ field: "role", op: "in", value: ["admin", "nobody"] }] })).map((doc) => doc.id), ["a"]);
    assert.deepEqual((await db.query({ collection: users, where: [{ field: "role", op: "!=", value: "team" }] })).map((doc) => doc.id), ["a"]);
    assert.equal(await db.count({ collection: users, where: [{ field: "role", op: "==", value: "team" }] }), 2);

    // IN lists beyond the Firestore cap are chunked and merged in order.
    const ids = Array.from({ length: 35 }, (_, index) => `n${index}`);
    await db.commit(ids.map((id, index) => ({ set: { collection: users, id, data: { role: "bulk", score: index } } })));
    const bulk = await db.query({ collection: users, where: [{ field: "score", op: "in", value: ids.map((_, index) => index) }, { field: "role", op: "==", value: "bulk" }], orderBy: [{ field: "score", direction: "desc" }], limit: 3 });
    assert.deepEqual(bulk.map((doc) => doc.id), ["n34", "n33", "n32"]);

    // Preconditions.
    await assert.rejects(db.commit([{ set: { collection: users, id: "a", data: { name: "dup" }, precondition: { exists: false } } }]), (error) => error instanceof FirestoreError && error.status === "ALREADY_EXISTS");
    await assert.rejects(db.commit([{ update: { collection: users, id: "nope", data: { name: "x" } } }]), (error) => error instanceof FirestoreError && error.status === "NOT_FOUND");
    await assert.rejects(db.commit([{ update: { collection: users, id: "a", data: { name: "x" }, precondition: { updateTime: "2000-01-01T00:00:00.000000Z" } } }]), (error) => error instanceof FirestoreError && error.status === "FAILED_PRECONDITION");
    await db.commit([{ update: { collection: users, id: "a", data: { score: 11 }, precondition: { updateTime: a.updateTime } } }]);
    const updated = await db.get(users, "a");
    assert.equal(updated.data.score, 11);
    assert.equal(updated.data.name, "Ada", "update keeps other fields");
    assert.notEqual(updated.updateTime, a.updateTime);

    // Atomic multi-document commit: one failing precondition aborts all writes.
    await assert.rejects(db.commit([
      { set: { collection: users, id: "z", data: { name: "never" } } },
      { delete: { collection: users, id: "ghost", precondition: { exists: true } } },
    ]));
    assert.equal(await db.get(users, "z"), null);

    // Transactions: read-modify-write with contention retry.
    const counters = col("counters");
    await db.commit([{ set: { collection: counters, id: "c", data: { value: 0 } } }]);
    await Promise.all(Array.from({ length: 6 }, () => db.runTransaction(async (tx) => {
      const doc = await tx.get(counters, "c");
      tx.write({ update: { collection: counters, id: "c", data: { value: doc.data.value + 1 } } });
      return doc.data.value;
    }, { attempts: 20 })));
    assert.equal((await db.get(counters, "c")).data.value, 6);

    // A transaction body that throws rolls back without writing.
    await assert.rejects(db.runTransaction(async (tx) => { tx.write({ set: { collection: counters, id: "x", data: { value: 1 } } }); throw new Error("boom"); }), /boom/);
    assert.equal(await db.get(counters, "x"), null);

    // Transactions can create-if-missing with a query inside.
    const result = await db.runTransaction(async (tx) => {
      const existing = await tx.query({ collection: counters, where: [{ field: "key", op: "==", value: "once" }], limit: 1 });
      if (existing.length) return existing[0].id;
      tx.write({ set: { collection: counters, id: "once-1", data: { key: "once" }, precondition: { exists: false } } });
      return "once-1";
    });
    assert.equal(result, "once-1");

    await db.commit([{ delete: { collection: users, id: "a" } }]);
    assert.equal(await db.get(users, "a"), null);
    // Deleting a missing document without a precondition is a no-op.
    await db.commit([{ delete: { collection: users, id: "already-gone" } }]);
  });
}
