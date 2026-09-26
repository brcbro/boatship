import assert from "node:assert/strict";
import test from "node:test";
import { emailDeliveryConfigured, sendEmail } from "../lib/email.ts";

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
  let called = false;
  globalThis.fetch = async (url, options) => {
    called = true;
    assert.equal(url, "https://cpaas.zoho.in/v1.1/email");
    assert.equal(options.headers.Authorization, "Zoho-enczapikey test-key");
    assert.deepEqual(JSON.parse(options.body), {
      from: { address: "sender@example.com", name: "Boatship" },
      to: [{ email_address: { address: "person@example.com" } }],
      subject: "Test",
      htmlbody: "<p>Test</p>",
    });
    return new Response(JSON.stringify({ request_id: "request-1" }), { status: 200 });
  };
  try {
    assert.equal(emailDeliveryConfigured(), true);
    assert.deepEqual(await sendEmail({ to: "person@example.com", subject: "Test", html: "<p>Test</p>" }), { id: "request-1", demo: false });
    assert.equal(called, true);
    delete process.env.ZEPTOMAIL_FROM;
    assert.equal(emailDeliveryConfigured(), false);
    await assert.rejects(sendEmail({ to: "person@example.com", subject: "Test", html: "Test" }), /sender is not configured/);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.ZEPTOMAIL_API_KEY; else process.env.ZEPTOMAIL_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.ZEPTOMAIL_FROM; else process.env.ZEPTOMAIL_FROM = previous.from;
  }
});
