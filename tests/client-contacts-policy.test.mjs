import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentPrimaryContact } from "../lib/client-contacts-policy.ts";

test("current primary contact is protected even when its directory ID changes", () => {
  assert.equal(isCurrentPrimaryContact("Owner@Example.com", "owner@example.com"), true);
  assert.equal(isCurrentPrimaryContact("former@example.com", "owner@example.com"), false);
});
