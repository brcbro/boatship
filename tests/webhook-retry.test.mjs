import assert from "node:assert/strict";
import test from "node:test";
import { webhookRetry } from "../lib/webhook-retry.ts";

test("webhook retries back off and stop after ten claimed attempts", () => {
  const now = Date.parse("2026-09-26T00:00:00Z");
  assert.deepEqual(webhookRetry(1, now), {
    state: "pending", nextAttemptAt: "2026-09-26T00:02:00.000Z",
  });
  assert.deepEqual(webhookRetry(10, now), {
    state: "failed", nextAttemptAt: "2026-09-26T01:00:00.000Z",
  });
});
