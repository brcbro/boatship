import assert from "node:assert/strict";
import test from "node:test";
import { applyFormSubmission, FormSubmissionError } from "../lib/form-submission.ts";

function fixture() {
  return {
    forms: [{ id: "form-a", clientId: "client-a", engagementId: "project-a", formTemplateId: "template-a", taskId: null, status: "not_started", responses: { email: "existing@example.test", name: "Existing name" }, riskScore: null, submittedAt: null, reviewedAt: null, reviewNote: "" }],
    formTemplates: [{ id: "template-a", mode: "native", fields: [
      { key: "email", label: "Email", type: "email", required: true },
      { key: "name", label: "Name", type: "text", required: false },
      { key: "risk", label: "Risk", type: "checkbox", required: false },
    ] }],
    clients: [{ id: "client-a", name: "Original", companyName: "Example", primaryContactEmail: "original@example.test", customFields: { Existing: "kept" } }],
    activity: [],
    webhooks: [
      { id: "active", active: true, events: ["form.submitted"] },
      { id: "inactive", active: false, events: ["form.submitted"] },
      { id: "other", active: true, events: ["client.created"] },
    ],
    webhookDeliveries: [],
  };
}
const input = { id: "form-a", responses: { risk: true }, actorId: "user-a", actorName: "Example actor", submittedAt: "2026-10-14T00:00:00.000Z" };

test("one form submission updates answers, client identity, activity and webhook intent together", () => {
  const data = fixture();
  const updated = applyFormSubmission(data, { ...input, riskScore: 99 });
  assert.equal(updated.status, "submitted");
  assert.equal(updated.responses.email, "existing@example.test");
  assert.equal(updated.responses.name, "Existing name");
  assert.equal(updated.riskScore, 1);
  assert.equal(data.clients[0].name, "Existing name");
  assert.equal(data.clients[0].primaryContactEmail, "existing@example.test");
  assert.equal(data.clients[0].customFields.Existing, "kept");
  assert.equal(data.activity.length, 1);
  assert.equal(data.activity[0].action, "form.submitted");
  assert.equal(data.webhookDeliveries.length, 1);
  assert.equal(data.webhookDeliveries[0].webhookId, "active");
  assert.equal(data.webhookDeliveries[0].state, "pending");
  assert.equal(data.webhookDeliveries[0].payload.riskScore, 1);
  assert.equal(data.webhookDeliveries[0].payload.engagementId, "project-a");
});

test("a duplicate or reviewed submission cannot overwrite evidence or duplicate activity/webhook intent", () => {
  const data = fixture();
  applyFormSubmission(data, input);
  const before = structuredClone(data);
  assert.throws(() => applyFormSubmission(data, { ...input, responses: { email: "replacement@example.test" } }), (error) => error instanceof FormSubmissionError && error.status === 409);
  assert.deepEqual(data, before);
  data.forms[0].status = "reviewed";
  const reviewed = structuredClone(data);
  assert.throws(() => applyFormSubmission(data, input), (error) => error.status === 409);
  assert.deepEqual(data, reviewed);
});

test("validation failures leave the whole snapshot untouched", () => {
  for (const responses of [{ email: "invalid" }, { unexpected: "answer" }, { email: {} }, { risk: "true" }]) {
    const data = fixture();
    const before = structuredClone(data);
    assert.throws(() => applyFormSubmission(data, { ...input, responses }), (error) => error instanceof FormSubmissionError && error.status === 400);
    assert.deepEqual(data, before);
  }
  const missing = fixture();
  missing.clients = [];
  const before = structuredClone(missing);
  assert.throws(() => applyFormSubmission(missing, input), (error) => error.status === 404);
  assert.deepEqual(missing, before);
});
