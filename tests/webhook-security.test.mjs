import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { publicWebhook, validateWebhookUrl } from "../lib/webhook-security.ts";

const previous = process.env.WEBHOOK_ALLOWED_ORIGINS;
before(() => { process.env.WEBHOOK_ALLOWED_ORIGINS = "https://hooks.example.com"; });
after(() => {
  if (previous === undefined) delete process.env.WEBHOOK_ALLOWED_ORIGINS;
  else process.env.WEBHOOK_ALLOWED_ORIGINS = previous;
});

test("webhook destinations require an exact approved HTTPS origin", () => {
  assert.equal(validateWebhookUrl("https://hooks.example.com/events"), null);
  for (const url of [
    "http://hooks.example.com/events",
    "https://hooks.example.com.evil.test/events",
    "https://hooks.example.com:8443/events",
    "https://user:pass@hooks.example.com/events",
    "https://hooks.example.com/events#fragment",
    "https://127.0.0.1/events",
    "https://[::1]/events",
    "https://localhost/events",
  ]) {
    assert.ok(validateWebhookUrl(url), `Expected rejection: ${url}`);
  }
});

test("public webhook representation does not expose its signing secret", () => {
  const shown = publicWebhook({
    id: "1", name: "test", url: "https://hooks.example.com/events",
    secret: "private-signing-value", events: ["client.created"], active: true,
    createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(shown.hasSecret, true);
  assert.equal("secret" in shown, false);
  assert.equal(JSON.stringify(shown).includes("private-signing-value"), false);
});
