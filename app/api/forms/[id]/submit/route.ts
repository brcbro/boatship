import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import {
  isNativeTemplate,
  validateFormResponses,
} from "@/lib/form-fields";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { FormSubmissionError } from "@/lib/form-submission";
import { validateResourceEngagement } from "@/lib/engagement-resources";
import { drainWebhooks } from "@/lib/webhooks";
import { drainAfterResponse } from "@/lib/queue-drain";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const form = await store.getForm(id);
    if (!form) throw jsonError("Form not found", 404);
    if (!await canAccessClient(session, form.clientId)) throw jsonError("Forbidden", 403);
    if (form.status !== "not_started") throw jsonError("This form has already been submitted.", 409);
    const engagementId = await validateResourceEngagement(form.clientId, form.engagementId, form.taskId);

    const text = await req.text();
    if (text.length > 500000) throw jsonError("Form answers are too large.", 413);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
      body = parsed as Record<string, unknown>;
    } catch {
      throw jsonError("Provide a valid form submission.", 400);
    }
    const template = await store.getFormTemplate(form.formTemplateId);
    if (!template) throw jsonError("Form template could not be found.", 404);
    const fields = template?.fields || [];
    let responses = {};
    if (isNativeTemplate(template) || fields.length > 0) {
      const raw = Object.hasOwn(body, "responses") ? body.responses : {};
      const supplied = validateFormResponses(fields, raw, { partial: true });
      if (!supplied.valid) {
        throw jsonError(Object.values(supplied.errors).join(" "), 400);
      }
      const checked = validateFormResponses(fields, { ...(form.responses || {}), ...supplied.responses });
      if (!checked.valid) throw jsonError(Object.values(checked.errors).join(" "), 400);
      responses = supplied.responses;
    } else if (Object.hasOwn(body, "responses")) {
      const checked = validateFormResponses([], body.responses);
      if (!checked.valid) throw jsonError("Answers for this form are collected in Google Forms.", 400);
    }

    try {
      const updated = await store.submitFormOnce({ id, responses, actorId: session.uid, actorName: session.name, submittedAt: new Date().toISOString() });
      drainAfterResponse("webhook", () => drainWebhooks());
      return { form: { ...updated, engagementId } };
    } catch (cause) {
      if (cause instanceof FormSubmissionError) throw jsonError(cause.message, cause.status);
      throw cause;
    }
  });
}
