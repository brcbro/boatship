import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentOnboardingTask } from "../lib/onboarding-health.ts";

test("onboarding health excludes work in later engagements", () => {
  const task = { clientId: "client-a", title: "Deliver project", metadata: { origin: "manual" } };
  assert.equal(isCurrentOnboardingTask(task), true);
  assert.equal(isCurrentOnboardingTask({ ...task, engagementId: "onboarding_client-a" }), true);
  assert.equal(isCurrentOnboardingTask({ ...task, engagementId: "project-2" }), false);
});
