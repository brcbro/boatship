// Self-check for /api/book with ZeptoMail mocked. Run: node worker/book.check.mjs
import assert from "node:assert/strict";
import worker, { isSlotOpen } from "./index.js";

// next non-Sunday date at least 2 days out, so the check never goes stale
const nextOpenDay = (() => {
  const d = new Date(Date.now() + 2 * 864e5);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const env = {
  ZEPTOMAIL_API: "https://zepto.test/v1.1/email", ZEPTOMAIL_TOKEN: "Zoho-enczapikey test",
  MAIL_FROM: "noreply@cohortix.in", OWNER_EMAIL: "owner@test.co",
  ASSETS: { fetch: () => new Response("asset") },
};
const sent = [];
let zeptoStatus = 200;
globalThis.fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response("{}", { status: zeptoStatus }); };

const post = (body) => worker.fetch(new Request("https://x/api/book", { method: "POST", body: JSON.stringify(body) }), env);
const valid = { name: "Param K", email: "p@x.co", phone: "+91 99999 99999", message: "Need a new <b>website", services: ["Website Development"], date: "2026-09-15", hour: 16 };

// slot rules, against a fixed "now" of Sun 13 Sep 2026 12:00 IST
const now = Date.parse("2026-09-13T06:30:00Z");
assert.ok(isSlotOpen("2026-09-15", 16, now), "Tuesday afternoon is open");
assert.ok(!isSlotOpen("2026-09-14", 9, now), "outside hours");
assert.ok(!isSlotOpen("2026-09-20", 12, now), "Sunday");
assert.ok(!isSlotOpen("2026-09-12", 12, now), "past date");
assert.ok(!isSlotOpen("2026-09-13", 12, now), "slot within the 1h notice");
assert.ok(!isSlotOpen("2026-11-30", 12, now), "beyond 45 days");
assert.ok(!isSlotOpen("2026-02-30", 12, now), "impossible date");
valid.date = nextOpenDay;

for (const [field, bad] of [["hour", 9], ["email", "nope"], ["email", "a@b"], ["phone", "----------"], ["phone", "12345"], ["name", "123"], ["message", "short"], ["services", []]]) {
  assert.equal((await post({ ...valid, [field]: bad })).status, 422, `rejects ${field}=${JSON.stringify(bad)}`);
}
assert.equal((await post({ ...valid, website: "bot" })).status, 200, "honeypot pretends success");
assert.equal(sent.length, 0, "nothing sent for invalid or bot requests");

assert.equal((await post(valid)).status, 200);
assert.equal(sent.length, 2);
const [owner, client] = sent.map((s) => s.body);
assert.equal(sent[0].init.headers.authorization, env.ZEPTOMAIL_TOKEN);
assert.equal(owner.to[0].email_address.address, "owner@test.co");
assert.equal(owner.reply_to[0].address, "p@x.co");
assert.equal(client.to[0].email_address.address, "p@x.co");
assert.match(client.subject, /^Your call with CohortIX is booked: \w+ \d{1,2} \w+ \d{4}, 4:00 PM IST$/);
assert.match(client.htmlbody, /Thank you, <em[^>]*>Param<\/em>/);
assert.ok(!owner.htmlbody.includes("<b>website"), "user input is escaped");

zeptoStatus = 401;
const originalError = console.error; console.error = () => {};
assert.equal((await post(valid)).status, 502, "ZeptoMail failure surfaces as 502");
console.error = originalError;

assert.equal(await (await worker.fetch(new Request("https://x/booked.html"), env)).text(), "asset", "other paths go to static assets");
console.log("book.check: all passed");
