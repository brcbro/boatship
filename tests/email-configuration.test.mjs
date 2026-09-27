import assert from "node:assert/strict";
import test from "node:test";
import {
  documentReviewedEmailHtml,
  emailDeliveryConfigured,
  inviteEmailHtml,
  sendEmail,
  taskAssignedEmailHtml,
  taskAssignedSubject,
  teamInviteEmailHtml,
  TEAM_WELCOME_SUBJECT,
  teamWelcomeEmailHtml,
} from "../lib/email.ts";

test("hosted email never reports a demo send", async () => {
  const previous = { node: process.env.NODE_ENV, key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM, zeptoKey: process.env.ZEPTOMAIL_API_KEY, zeptoFrom: process.env.ZEPTOMAIL_FROM };
  process.env.NODE_ENV = "production";
  delete process.env.RESEND_API_KEY;
  delete process.env.ZEPTOMAIL_API_KEY;
  try {
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /not configured/);
    process.env.RESEND_API_KEY = "unused-test-key";
    delete process.env.RESEND_FROM;
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /sender is not configured/);
    process.env.RESEND_FROM = "Boatship Onboarding <onboarding@cohortix.in>";
    assert.equal(emailDeliveryConfigured(), false);
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /sender is not configured/);
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = previous.from;
    if (previous.zeptoKey === undefined) delete process.env.ZEPTOMAIL_API_KEY; else process.env.ZEPTOMAIL_API_KEY = previous.zeptoKey;
    if (previous.zeptoFrom === undefined) delete process.env.ZEPTOMAIL_FROM; else process.env.ZEPTOMAIL_FROM = previous.zeptoFrom;
  }
});

test("ZeptoMail sends through the India API with a verified sender", async () => {
  const previous = { key: process.env.ZEPTOMAIL_API_KEY, from: process.env.ZEPTOMAIL_FROM, fetch: globalThis.fetch };
  process.env.ZEPTOMAIL_API_KEY = "test-key";
  process.env.ZEPTOMAIL_FROM = "sender@example.com";
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://cpaas.zoho.in/v1.1/email");
    assert.equal(options.headers.Authorization, "Zoho-enczapikey test-key");
    const data = JSON.parse(options.body);
    assert.deepEqual(data, {
      from: { address: process.env.ZEPTOMAIL_FROM.toLowerCase(), name: calls === 1 ? "Boatship" : "Boatship Team" },
      to: [{ email_address: { address: "person@example.com" } }],
      subject: "Test",
      htmlbody: "<p>Test</p>",
    });
    return new Response(JSON.stringify({ request_id: "request-1" }), { status: 200 });
  };
  try {
    assert.equal(emailDeliveryConfigured(), true);
    assert.deepEqual(await sendEmail({ to: "person@example.com", subject: "Test", html: "<p>Test</p>" }), { id: "request-1", demo: false });
    assert.equal(calls, 1);
    delete process.env.ZEPTOMAIL_FROM;
    assert.equal(emailDeliveryConfigured(), false);
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /sender is not configured/);
    process.env.ZEPTOMAIL_FROM = "Onboarding@cohortix.in";
    assert.equal(emailDeliveryConfigured(), false);
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /sender is not configured/);
    process.env.ZEPTOMAIL_FROM = "TEAM@COHORTIX.IN";
    assert.deepEqual(await sendEmail({ to: "person@example.com", senderName: "Boatship Team", subject: "Test", html: "<p>Test</p>" }), { id: "request-1", demo: false });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.ZEPTOMAIL_API_KEY; else process.env.ZEPTOMAIL_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.ZEPTOMAIL_FROM; else process.env.ZEPTOMAIL_FROM = previous.from;
  }
});

test("Client OS mail uses audience-specific copy and escapes user content", () => {
  const client = inviteEmailHtml({ name: '<Sam & Co>', companyName: '<Acme>', loginUrl: 'https://example.com/login?x="bad"' });
  assert.match(client, /Boatship workspace/);
  assert.doesNotMatch(client, /onboarding/i);
  assert.match(client, /&lt;Acme&gt;/);
  assert.match(client, /x=&quot;bad&quot;/);
  const team = teamInviteEmailHtml({ name: '<Sam>', role: 'team', loginUrl: 'https://example.com/login' });
  assert.match(team, /Boatship team/);
  assert.doesNotMatch(team, /client portal|onboarding/i);
  assert.match(team, /&lt;Sam&gt;/);
  assert.equal(taskAssignedSubject('Upload file', { type: 'onboarding', name: 'Onboarding' }), 'New onboarding task: Upload file');
  assert.equal(taskAssignedSubject('Upload file', { type: 'project', name: 'Website launch' }), 'New Website launch task: Upload file');
  assert.equal(taskAssignedSubject('Upload file'), 'New task: Upload file');
  const task = taskAssignedEmailHtml({ name: 'A', taskTitle: '<script>', link: 'https://example.com', engagement: { type: 'project', name: '<Launch>' } });
  assert.match(task, /&lt;script&gt;/);
  assert.match(task, /&lt;Launch&gt;/);
  assert.doesNotMatch(task, /onboarding/i);
  const document = documentReviewedEmailHtml({ name: 'A', fileName: '<file>', status: 'approved', note: '<img>', link: 'https://example.com' });
  assert.match(document, /&lt;img&gt;/);
  assert.equal(TEAM_WELCOME_SUBJECT, "Your Boatship Client OS is ready");
  const welcome = teamWelcomeEmailHtml({ name: '<Sam>', loginUrl: 'https://example.com/login?x="bad"' });
  assert.match(welcome, /client accounts, engagements, tasks, documents, and messages/);
  assert.match(welcome, /&lt;Sam&gt;/);
  assert.match(welcome, /x=&quot;bad&quot;/);
  assert.doesNotMatch(welcome, /onboarding|set your password/i);
});
