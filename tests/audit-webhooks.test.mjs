import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { parseWebhookEvents, signWebhookBody, webhookOwnerId, webhookOwnerScope } from "../lib/webhook-security.ts";
import { isStaleHeadUpdate, webhookBodyExternalId, webhookEventUpdatedAt } from "../lib/git-webhook-guard.ts";
import { appBaseUrl } from "../lib/client-status.ts";
import { internalCronUrl } from "../lib/cron-url.ts";
import { contentSecurityPolicy, securityHeaders } from "../lib/security-headers.ts";

const staff = { uid: "team-1", email: "t@example.com", name: "T", role: "team", clientId: null, status: "active" };

test("subscription events must all be known webhook events", () => {
  assert.deepEqual(parseWebhookEvents(["task.completed", "task.completed", "client.created"]), ["task.completed", "client.created"]);
  assert.equal(parseWebhookEvents(["task.completed", "user.password_reset"]), null);
  assert.equal(parseWebhookEvents("task.completed"), null);
});

test("owned hooks resolve their owner, including legacy MCP names and nameless hooks", () => {
  assert.equal(webhookOwnerId({ ownerId: "u1", name: "anything" }), "u1");
  assert.equal(webhookOwnerId({ name: "MCP:u2:abc" }), "u2");
  assert.equal(webhookOwnerId({ name: "Zapier" }), null);
  assert.equal(webhookOwnerId({}), null);
});

test("owned deliveries require active staff and a client-scoped payload", () => {
  const scope = webhookOwnerScope(staff, { clientId: "c1" });
  assert.equal(scope?.clientId, "c1");
  assert.equal(scope?.session.uid, "team-1");
  assert.equal(webhookOwnerScope(staff, { taskId: "t1" }), null);
  assert.equal(webhookOwnerScope(null, { clientId: "c1" }), null);
  assert.equal(webhookOwnerScope({ ...staff, role: "client", clientId: "c1" }, { clientId: "c1" }), null);
  assert.equal(webhookOwnerScope({ ...staff, status: "suspended" }, { clientId: "c1" }), null);
});

test("outbound signatures are HMAC-SHA256 over timestamp.body", () => {
  const expected = createHmac("sha256", "s3cret").update("1700000000.{\"a\":1}").digest("hex");
  assert.equal(signWebhookBody("s3cret", "1700000000", "{\"a\":1}"), expected);
  assert.notEqual(signWebhookBody("s3cret", "1700000001", "{\"a\":1}"), expected);
});

test("git webhook dedupe keys on the signed body and detects older heads", () => {
  assert.equal(webhookBodyExternalId("{}"), webhookBodyExternalId("{}"));
  assert.notEqual(webhookBodyExternalId("{}"), webhookBodyExternalId("{ }"));
  assert.equal(webhookEventUpdatedAt({ pull_request: { updated_at: "2026-10-01T00:00:00Z" } }), "2026-10-01T00:00:00.000Z");
  assert.equal(webhookEventUpdatedAt({ pull_request: { updated_at: "not a date" } }), null);
  const prior = [{ headSha: "aaa", eventUpdatedAt: "2026-10-01T00:00:00.000Z" }, { headSha: "bbb", eventUpdatedAt: "2026-10-02T00:00:00.000Z" }];
  assert.equal(isStaleHeadUpdate({ headSha: "aaa", eventUpdatedAt: null }, "bbb", prior), true);
  assert.equal(isStaleHeadUpdate({ headSha: "zzz", eventUpdatedAt: "2026-10-01T12:00:00.000Z" }, "bbb", prior), true);
  assert.equal(isStaleHeadUpdate({ headSha: "ccc", eventUpdatedAt: "2026-10-03T00:00:00.000Z" }, "bbb", prior), false);
  assert.equal(isStaleHeadUpdate({ headSha: "bbb", eventUpdatedAt: null }, "bbb", prior), false);
});

const savedEnv = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("production links never come from request host headers", () => {
  const forged = new Request("https://app.example/x", { headers: { host: "evil.example", "x-forwarded-host": "evil.example" } });
  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://app.example/";
  assert.equal(appBaseUrl(forged), "https://app.example");
  delete process.env.APP_URL;
  assert.throws(() => appBaseUrl(forged), /APP_URL is not configured/);
  process.env.NODE_ENV = "development";
  assert.equal(appBaseUrl(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000", "x-forwarded-host": "evil.example" } })), "http://localhost:3000");
});

test("cron requests use the configured origin or an internal one", () => {
  assert.equal(internalCronUrl("https://app.example/", "webhook-drain"), "https://app.example/api/internal/webhook-drain");
  assert.equal(internalCronUrl(undefined, "webhook-drain"), "https://app-runtime.internal/api/internal/webhook-drain");
  assert.equal(internalCronUrl("not a url", "x"), "https://app-runtime.internal/api/internal/x");
});

test("security headers block framing, referrers and remote images", () => {
  const csp = contentSecurityPolicy(false);
  assert.match(csp, /img-src 'self' data: blob:(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' wss:(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(contentSecurityPolicy(true), /unsafe-eval/);
  const prod = Object.fromEntries(securityHeaders(false).map(({ key, value }) => [key, value]));
  assert.equal(prod["Referrer-Policy"], "no-referrer");
  assert.equal(prod["X-Frame-Options"], "DENY");
  assert.equal(prod["X-Content-Type-Options"], "nosniff");
  assert.ok(prod["Strict-Transport-Security"]);
  assert.ok(prod["Permissions-Policy"]);
  assert.equal(securityHeaders(true).some(({ key }) => key === "Strict-Transport-Security"), false);
});
