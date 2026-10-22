import assert from "node:assert/strict";
import test from "node:test";
import { resourceEngagementId, resourceInEngagement } from "../lib/resource-engagement-scope.ts";

test("account-wide and legacy task-linked records retain distinct contexts", () => {
  const tasks = [{ id: "a", clientId: "client-a" }, { id: "b", clientId: "client-a", engagementId: "project-b" }, { id: "other", clientId: "client-b", engagementId: "private" }];
  assert.equal(resourceEngagementId({ clientId: "client-a", taskId: "a" }, tasks), "onboarding_client-a");
  assert.equal(resourceEngagementId({ clientId: "client-a", taskId: "b" }, tasks), "project-b");
  assert.equal(resourceEngagementId({ clientId: "client-a", taskId: "other" }, tasks), null);
  assert.equal(resourceEngagementId({ clientId: "client-a" }, tasks), null);
  assert.equal(resourceInEngagement({ clientId: "client-a" }, tasks, "project-b"), false);
  assert.equal(resourceInEngagement({ clientId: "client-a" }, tasks, "project-b", true), true);
  assert.equal(resourceInEngagement({ clientId: "client-a", taskId: "b" }, tasks, "account"), false);
});
