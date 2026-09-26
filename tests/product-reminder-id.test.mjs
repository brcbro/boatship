import assert from "node:assert/strict";
import test from "node:test";
import { productReminderId } from "../lib/product-reminder-id.ts";

test("one reminder per item and recipient each day", () => {
  const id = productReminderId("2026-09-26", "work", "item", "user");
  assert.equal(id, productReminderId("2026-09-26", "work", "item", "user"));
  assert.notEqual(id, productReminderId("2026-09-27", "work", "item", "user"));
  assert.notEqual(id, productReminderId("2026-09-26", "work", "item", "other"));
});
