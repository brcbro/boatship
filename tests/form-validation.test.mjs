import assert from "node:assert/strict";
import test from "node:test";
import { clientDetailsFromForm, computeRiskScore, isValidEmail, normalizeFormFields, validateFormResponses } from "../lib/form-fields.ts";

const field = (key, type, options = {}) => ({ key, label: key, type, required: false, ...options });

test("email and dropdown fields reject invalid values even when required answers are present", () => {
  const fields = [field("email", "email", { required: true }), field("service", "dropdown", { required: true, options: ["Website", "App"] })];
  const invalid = validateFormResponses(fields, { email: "invalid", service: "Unknown" });
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ["email", "service"]);
  const valid = validateFormResponses(fields, { email: " USER@EXAMPLE.TEST ", service: "Website" });
  assert.equal(valid.valid, true);
  assert.equal(valid.responses.email, "user@example.test");
  assert.equal(isValidEmail("a..b@example.test"), false);
  assert.equal(isValidEmail("a@example..test"), false);
  assert.equal(isValidEmail("user+tag@example.test"), true);
});

test("numbers, calendar dates, checkbox types, and file references have strict field shapes", () => {
  const fields = [field("amount", "number"), field("date", "date"), field("agreement", "checkbox"), field("attachment", "file")];
  for (const amount of [Infinity, NaN, "0x10", "12 dollars", {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateFormResponses(fields, { amount }).valid, false);
  }
  for (const date of ["2026-02-30", "2025-02-29", "2026-13-01", "0000-01-01", "10/14/2026"]) {
    assert.equal(validateFormResponses(fields, { date }).valid, false);
  }
  assert.equal(validateFormResponses(fields, { agreement: "true" }).valid, false);
  assert.equal(validateFormResponses(fields, { attachment: { url: "example.test" } }).valid, false);
  const checked = validateFormResponses(fields, { amount: "1.25e2", date: "2024-02-29", agreement: false, attachment: "reference.pdf" });
  assert.equal(checked.valid, true);
  assert.equal(checked.responses.amount, 125);
  assert.equal(checked.responses.agreement, false);
});

test("unknown keys, object answers, malformed response collections, and excessive strings are rejected", () => {
  const fields = [field("name", "text"), field("notes", "textarea")];
  for (const raw of [null, [], "answer", { unknown: "value" }, { name: {} }, { name: true }, { name: "a".repeat(2001) }, { notes: "a".repeat(20001) }, JSON.parse('{"__proto__":"value"}')]) {
    assert.equal(validateFormResponses(fields, raw).valid, false);
  }
  assert.equal(validateFormResponses(fields, { notes: "Line one\nLine two", name: "Sample" }).valid, true);
  assert.equal(validateFormResponses(fields, { name: "bad\u0000answer" }).valid, false);
  assert.deepEqual(normalizeFormFields([{ key: "__proto__", label: "unsafe" }, { key: "one", label: "One" }, { key: "one", label: "Duplicate" }]).map((item) => item.key), ["one"]);
});

test("only visible required fields block submission and hidden answers do not affect the risk score", () => {
  const fields = [
    field("risk", "checkbox", { required: true }),
    field("risk_details", "textarea", { required: true, showIf: { key: "risk", equals: "true" } }),
    field("sanction", "checkbox", { showIf: { key: "risk", equals: "true" } }),
  ];
  const low = validateFormResponses(fields, { risk: false, sanction: true });
  assert.equal(low.valid, true);
  assert.equal(computeRiskScore(fields, low.responses), 0);
  const missing = validateFormResponses(fields, { risk: true });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.risk_details, /required/);
  const high = validateFormResponses(fields, { risk: true, risk_details: "Details", sanction: true });
  assert.equal(high.valid, true);
  assert.equal(computeRiskScore(fields, high.responses), 2);
  assert.equal(validateFormResponses(fields, {}, { partial: true }).valid, true);
});

test("blank or conditionally hidden answers do not erase current client identity", () => {
  const client = { name: "Current name", companyName: "Current company", primaryContactEmail: "current@example.test", customFields: { Existing: "kept" } };
  const fields = [field("name", "text"), field("email", "email", { showIf: { key: "change_email", equals: "true" } }), field("change_email", "checkbox")];
  const updated = clientDetailsFromForm(client, fields, { name: "", email: "hidden@example.test", change_email: false });
  assert.equal(updated.name, client.name);
  assert.equal(updated.primaryContactEmail, client.primaryContactEmail);
  assert.equal(updated.customFields.Existing, "kept");
});
