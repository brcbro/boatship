import { internalErrorResponse, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

function csvEscape(value: string | number | boolean | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId")?.trim() || "";
    if (!clientId) throw jsonError("clientId is required", 400);

    if (isStaff(session.role)) {
      if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    } else if (session.role === "client") {
      if (session.clientId !== clientId) throw jsonError("Forbidden", 403);
    } else {
      throw jsonError("Forbidden", 403);
    }

    const store = await getStore();
    const [forms, templates] = await Promise.all([
      store.listForms(clientId),
      store.listFormTemplates(),
    ]);
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    const header = [
      "submissionId",
      "clientId",
      "templateId",
      "templateName",
      "status",
      "riskScore",
      "submittedAt",
      "reviewedAt",
      "reviewNote",
      "fieldKey",
      "fieldLabel",
      "value",
    ];

    const rows: string[] = [header.join(",")];

    for (const form of forms) {
      const tmpl = templateMap.get(form.formTemplateId);
      const fields = tmpl?.fields || [];
      const fieldLabels = new Map(fields.map((f) => [f.key, f.label]));
      const responseKeys = Object.keys(form.responses || {});
      const keys =
        fields.length > 0
          ? Array.from(new Set([...fields.map((f) => f.key), ...responseKeys]))
          : responseKeys.length
            ? responseKeys
            : [""];

      for (const key of keys) {
        const value =
          key === ""
            ? ""
            : form.responses?.[key] === null || form.responses?.[key] === undefined
              ? ""
              : form.responses[key];
        rows.push(
          [
            csvEscape(form.id),
            csvEscape(form.clientId),
            csvEscape(form.formTemplateId),
            csvEscape(tmpl?.name || ""),
            csvEscape(form.status),
            csvEscape(form.riskScore),
            csvEscape(form.submittedAt),
            csvEscape(form.reviewedAt),
            csvEscape(form.reviewNote),
            csvEscape(key),
            csvEscape(fieldLabels.get(key) || key),
            csvEscape(value as string | number | boolean | null),
          ].join(",")
        );
      }
    }

    return new Response(rows.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="boatship-forms-${clientId}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return internalErrorResponse(err);
  }
}
