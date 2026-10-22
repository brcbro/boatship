import { randomUUID } from "node:crypto";
import type { ActivityLog, Client, FormSubmission, FormTemplate, Task, WebhookDelivery, WebhookEndpoint } from "@/types";
import { clientDetailsFromForm, computeRiskScore, isNativeTemplate, validateFormResponses } from "./form-fields";
import { resourceEngagementId } from "./resource-engagement-scope";

export class FormSubmissionError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export type FormSubmissionInput = { id: string; responses: FormSubmission["responses"]; actorId: string; actorName: string; submittedAt: string };
type SubmissionData = { forms: FormSubmission[]; formTemplates: FormTemplate[]; clients: Client[]; tasks: Task[]; activity: ActivityLog[]; webhooks: WebhookEndpoint[]; webhookDeliveries: WebhookDelivery[] };

/** All domain effects, including webhook intent, commit in one snapshot mutation. */
export function applyFormSubmission(data: SubmissionData, input: FormSubmissionInput): FormSubmission {
  const form = data.forms.find((item) => item.id === input.id);
  if (!form) throw new FormSubmissionError("Form not found", 404);
  if (form.status !== "not_started") throw new FormSubmissionError("This form has already been submitted.", 409);
  const template = data.formTemplates.find((item) => item.id === form.formTemplateId);
  const client = data.clients.find((item) => item.id === form.clientId);
  if (!template || !client) throw new FormSubmissionError("Form template or client could not be found.", 404);
  const fields = template.fields || [];
  let responses = form.responses || {};
  if (isNativeTemplate(template) || fields.length) {
    const checked = validateFormResponses(fields, { ...responses, ...input.responses });
    if (!checked.valid) throw new FormSubmissionError(Object.values(checked.errors).join(" "), 400);
    responses = checked.responses;
  } else if (Object.keys(input.responses).length) throw new FormSubmissionError("Answers for this form are collected in Google Forms.", 400);
  const riskScore = fields.length ? computeRiskScore(fields, responses) : form.riskScore;
  Object.assign(form, { responses, riskScore, status: "submitted", submittedAt: input.submittedAt, engagementId: resourceEngagementId(form, data.tasks) });
  if (fields.length) Object.assign(client, clientDetailsFromForm(client, fields, responses), { updatedAt: input.submittedAt });
  data.activity.push({ id: randomUUID(), clientId: form.clientId, actorId: input.actorId, actorName: input.actorName, action: "form.submitted", timestamp: input.submittedAt, meta: { formId: form.id, formTemplateId: form.formTemplateId, riskScore, engagementId: form.engagementId ?? null } });
  const payload = { formId: form.id, formTemplateId: form.formTemplateId, clientId: form.clientId, clientName: client.name, companyName: client.companyName, riskScore, engagementId: form.engagementId ?? null };
  for (const hook of data.webhooks.filter((item) => item.active && item.events.includes("form.submitted"))) {
    data.webhookDeliveries.push({ id: randomUUID(), webhookId: hook.id, event: "form.submitted", payload, statusCode: null, success: false, error: null, state: "pending", attempts: 0, nextAttemptAt: input.submittedAt, leaseUntil: null, leaseToken: null, createdAt: input.submittedAt });
  }
  return form;
}
