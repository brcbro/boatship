import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { createProductWithOwner, createReleaseWithWorkItems, updateReleaseWithWorkItems, transferProductOwner, removeProductMember } = await import("../lib/product-persistence.ts");
const { PRODUCTS, PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_WORK_ITEMS, PRODUCT_RELEASES, createProductMilestone, createProductWorkItem, productMemberId } = await import("../lib/products.ts");
const { scanProductReminders } = await import("../lib/product-reminders.ts");

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  return db;
}

const newProduct = (name = "Harbour", ownerId = "owner_1") => createProductWithOwner({ name, type: "saas", description: "d" }, ownerId, name.toLowerCase());

test("createProductWithOwner writes the product and its owner membership, then transferProductOwner swaps roles atomically", async () => {
  const db = fresh();
  const product = await newProduct();
  assert.equal((await db.get("Product", product.id)).data.slug, "harbour");
  const owner = await PRODUCT_MEMBERS.get(productMemberId(product.id, "owner_1"));
  assert.equal(owner?.role, "owner");
  await assert.rejects(newProduct("Harbour", "owner_2"), (error) => error.status === 409, "duplicate slug is refused");

  await assert.rejects(transferProductOwner(product.id, "someone_else", "owner_2", { ownerId: "owner_2" }), (error) => error.status === 409);
  assert.equal((await PRODUCTS.get(product.id)).ownerId, "owner_1", "a failed transfer leaves the product untouched");

  const updated = await transferProductOwner(product.id, "owner_1", "owner_2", { ownerId: "owner_2", name: "Harbour 2", websiteUrl: undefined });
  assert.equal(updated.ownerId, "owner_2");
  assert.equal(updated.name, "Harbour 2");
  const stored = await PRODUCTS.get(product.id);
  assert.equal(stored.ownerId, "owner_2");
  assert.equal(stored.websiteUrl, null, "undefined fields do not erase stored values");
  assert.equal((await PRODUCT_MEMBERS.get(productMemberId(product.id, "owner_2")))?.role, "owner");
  assert.equal((await PRODUCT_MEMBERS.get(productMemberId(product.id, "owner_1")))?.role, "editor");
});

test("release work item links live on the release document and are replaced on update", async () => {
  fresh();
  const product = await newProduct();
  const a = await createProductWorkItem(product.id, { title: "A" });
  const b = await createProductWorkItem(product.id, { title: "B" });
  const c = await createProductWorkItem(product.id, { title: "C" });
  const release = await createReleaseWithWorkItems(product.id, { version: "1.0.0", status: "released", workItemIds: [a.id, b.id] });
  assert.deepEqual(release.workLinks, [{ workItemId: a.id }, { workItemId: b.id }]);
  assert.ok(release.releasedAt, "released status stamps releasedAt");
  assert.deepEqual((await PRODUCT_RELEASES.get(release.id)).workItemIds, [a.id, b.id]);

  const updated = await updateReleaseWithWorkItems(release.id, { notes: "hotfix", releasedAt: "2026-01-02" }, [b.id, c.id]);
  assert.deepEqual(updated.workLinks.map((link) => link.workItemId), [b.id, c.id]);
  assert.equal(updated.notes, "hotfix");
  assert.equal(updated.releasedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(updated.version, "1.0.0");
  assert.deepEqual((await PRODUCT_RELEASES.get(release.id)).workItemIds, [b.id, c.id]);
  await assert.rejects(updateReleaseWithWorkItems("missing", {}, []), (error) => error.status === 409);
});

test("removeProductMember refuses the owner and clears assignee/owner fields for a removed member", async () => {
  fresh();
  const product = await newProduct();
  const memberId = productMemberId(product.id, "editor_1");
  await PRODUCT_MEMBERS.set(memberId, { id: memberId, productId: product.id, userId: "editor_1", role: "editor", createdAt: new Date().toISOString() });
  const work = await createProductWorkItem(product.id, { title: "Assigned", assigneeId: "editor_1" });
  const other = await createProductWorkItem(product.id, { title: "Other", assigneeId: "owner_1" });
  const milestone = await createProductMilestone(product.id, { title: "M", ownerId: "editor_1" });

  assert.equal(await removeProductMember(product.id, productMemberId(product.id, "owner_1"), "owner_1"), false);
  assert.ok(await PRODUCT_MEMBERS.get(productMemberId(product.id, "owner_1")), "the owner membership stays");
  assert.equal(await removeProductMember(product.id, memberId, "wrong_user"), false);

  assert.equal(await removeProductMember(product.id, memberId, "editor_1"), true);
  assert.equal(await PRODUCT_MEMBERS.get(memberId), null);
  assert.equal((await PRODUCT_WORK_ITEMS.get(work.id)).assigneeId, null);
  assert.equal((await PRODUCT_WORK_ITEMS.get(other.id)).assigneeId, "owner_1");
  assert.equal((await PRODUCT_MILESTONES.get(milestone.id)).ownerId, null);
});

test("the reminder scan creates one notification per recipient per day and is idempotent", async () => {
  const db = fresh();
  const product = await newProduct();
  const memberId = productMemberId(product.id, "editor_1");
  await PRODUCT_MEMBERS.set(memberId, { id: memberId, productId: product.id, userId: "editor_1", role: "editor", createdAt: new Date().toISOString() });
  await createProductWorkItem(product.id, { title: "Late", assigneeId: "editor_1", dueDate: "2026-01-01" });
  await createProductWorkItem(product.id, { title: "Done late", assigneeId: "editor_1", dueDate: "2026-01-01", status: "done" });
  await createProductWorkItem(product.id, { title: "Future", assigneeId: "editor_1", dueDate: "2027-01-01" });
  await createProductWorkItem(product.id, { title: "No date", assigneeId: "editor_1" });
  await createProductMilestone(product.id, { title: "Slipped", targetDate: "2026-01-05", ownerId: "owner_1" });
  const paused = await createProductWithOwner({ name: "Paused", type: "other", stage: "paused" }, "owner_1", "paused");
  await createProductWorkItem(paused.id, { title: "Ignored", dueDate: "2026-01-01" });

  const now = new Date("2026-02-01T12:00:00.000Z");
  const first = await scanProductReminders(now);
  assert.deepEqual(first, { scanned: 2, created: 3 });
  const notes = await db.query({ collection: "NotificationRecord" });
  assert.equal(notes.length, 3);
  assert.deepEqual(notes.map((n) => n.data.userId).sort(), ["editor_1", "owner_1", "owner_1"]);
  assert.ok(notes.every((n) => n.data.kind === "task_overdue" && n.data.readAt === null && n.data.createdAt === now.toISOString()));
  assert.ok(notes.some((n) => n.data.body === "Harbour · due 2026-01-01"));

  const again = await scanProductReminders(now);
  assert.deepEqual(again, { scanned: 2, created: 0 });
  assert.equal((await db.query({ collection: "NotificationRecord" })).length, 3);

  const nextDay = await scanProductReminders(new Date("2026-02-02T12:00:00.000Z"));
  assert.equal(nextDay.created, 3);
});
