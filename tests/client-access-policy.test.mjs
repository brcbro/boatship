import assert from "node:assert/strict";
import test from "node:test";
import { hasClientAssignment } from "../lib/client-access-policy.ts";

test("admins may access assigned and unassigned clients", () => {
  assert.equal(hasClientAssignment("admin", "admin-1", null, "client-a", null), true);
  assert.equal(hasClientAssignment("admin", "admin-1", null, "client-b", "team-2"), true);
});

test("team users may access only their currently assigned client", () => {
  assert.equal(hasClientAssignment("team", "team-1", null, "client-a", "team-1"), true);
  assert.equal(hasClientAssignment("team", "team-1", null, "client-b", "team-2"), false);
  assert.equal(hasClientAssignment("team", "team-1", null, "client-c", null), false);
  assert.equal(hasClientAssignment("team", "team-1", null, "missing", undefined), false);
});

test("client users may access only their own client", () => {
  assert.equal(hasClientAssignment("client", "user-1", "client-a", "client-a", "team-2"), true);
  assert.equal(hasClientAssignment("client", "user-1", "client-a", "client-b", "team-2"), false);
});
