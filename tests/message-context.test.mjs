import assert from "node:assert/strict";
import test from "node:test";
import { messageMatchesContext } from "../lib/message-context.ts";

test("all-work messages preserve legacy behavior while explicit filters isolate engagements", () => {
  const rows = [{ engagementId: "project-a" }, { engagementId: "project-b" }, { engagementId: null }, {}];
  assert.deepEqual(rows.map((row) => messageMatchesContext(row, "")), [true, true, true, true]);
  assert.deepEqual(rows.map((row) => messageMatchesContext(row, "project-a")), [true, false, false, false]);
  assert.deepEqual(rows.map((row) => messageMatchesContext(row, "account")), [false, false, true, true]);
});

test("account-wide messages only join an engagement conversation when explicitly requested", () => {
  assert.equal(messageMatchesContext({}, "project-a", false), false);
  assert.equal(messageMatchesContext({}, "project-a", true), true);
  assert.equal(messageMatchesContext({ engagementId: "project-b" }, "project-a", true), false);
  assert.equal(messageMatchesContext({ engagementId: "project-a" }, "account", true), false);
});
