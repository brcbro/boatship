import assert from "node:assert/strict";
import test from "node:test";
import { legacyEngagementId, taskEngagementId } from "../lib/engagement-scope.ts";
import { hasClientAssignment } from "../lib/client-access-policy.ts";

test("legacy tasks stay in onboarding while new work stays in its engagement", () => {
  const legacy = { clientId: "client-a" };
  const project = { clientId: "client-a", engagementId: "project-b" };
  assert.equal(taskEngagementId(legacy), legacyEngagementId("client-a"));
  assert.equal(taskEngagementId(project), "project-b");
  assert.notEqual(taskEngagementId(project), taskEngagementId(legacy));
});

test("engagement access follows the owning client assignment", () => {
  assert.equal(hasClientAssignment("client", "user-a", "client-a", "client-a", null), true);
  assert.equal(hasClientAssignment("client", "user-a", "client-a", "client-b", null), false);
  assert.equal(hasClientAssignment("team", "staff-a", null, "client-a", "staff-b"), false);
});
