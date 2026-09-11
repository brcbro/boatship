import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import {
  computeRiskScore,
  isNativeTemplate,
  missingRequiredFields,
} from "@/lib/form-fields";
import { canAccessClient } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { dispatchWebhooks } from "@/lib/webhooks";
import type { FormSubmission } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const form = await store.getForm(id);
    if (!form) throw jsonError("Form not found", 404);
    if (!canAccessClient(session, form.clientId)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      responses?: FormSubmission["responses"];
      riskScore?: number | null;
    };

    const responses = body.responses ?? form.responses ?? {};
    const template = await store.getFormTemplate(form.formTemplateId);
    const fields = template?.fields || [];

    if (template && (isNativeTemplate(template) || fields.length > 0)) {
      const missing = missingRequiredFields(fields, responses);
      if (missing.length) {
        throw jsonError(
          `Missing required fields: ${missing.map((f) => f.label || f.key).join(", ")}`,
          400
        );
      }
    }

    let riskScore: number | null =
      typeof body.riskScore === "number" && Number.isFinite(body.riskScore)
        ? Math.max(0, Math.round(body.riskScore))
        : body.riskScore === null
          ? null
          : form.riskScore;

    if (fields.length > 0) {
      riskScore = computeRiskScore(fields, responses);
    }

    const updated = await store.updateForm(id, {
      responses,
      riskScore,
      status: "submitted",
      submittedAt: new Date().toISOString(),
    });

    await store.addActivity({
      clientId: form.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "form.submitted",
      meta: {
        formId: id,
        formTemplateId: form.formTemplateId,
        riskScore: updated.riskScore,
      },
    });

    const client = await store.getClient(form.clientId);
    void dispatchWebhooks("form.submitted", {
      formId: updated.id,
      formTemplateId: updated.formTemplateId,
      clientId: form.clientId,
      clientName: client?.name ?? null,
      companyName: client?.companyName ?? null,
      riskScore: updated.riskScore,
    });

    return { form: updated };
  });
}
