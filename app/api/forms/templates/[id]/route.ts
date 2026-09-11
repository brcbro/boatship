import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { normalizeFormFields } from "@/lib/form-fields";
import { toGoogleFormEmbedUrl, isGoogleFormsUrl } from "@/lib/google-forms";
import { canManageTemplates } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { FormTemplate } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getFormTemplate(id);
    if (!existing) throw jsonError("Form template not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      googleFormUrl?: string;
      googleFormEmbedUrl?: string;
      mode?: "google" | "native";
      fields?: unknown;
    };

    const fields =
      body.fields !== undefined
        ? normalizeFormFields(body.fields)
        : existing.fields || [];

    const mode: FormTemplate["mode"] =
      body.mode === "native" || body.mode === "google"
        ? body.mode
        : fields.length > 0 && !body.googleFormUrl?.trim() && !existing.googleFormUrl
          ? "native"
          : existing.mode || (fields.length ? "native" : "google");

    const url =
      body.googleFormUrl !== undefined
        ? body.googleFormUrl.trim()
        : existing.googleFormUrl || "";

    if (mode === "google") {
      if (!url) throw jsonError("googleFormUrl is required for Google Forms mode", 400);
      if (!isGoogleFormsUrl(url)) {
        throw jsonError("URL must be a Google Forms link (docs.google.com/forms/...)", 400);
      }
    } else if (url && !isGoogleFormsUrl(url)) {
      throw jsonError("URL must be a Google Forms link (docs.google.com/forms/...)", 400);
    }

    const template = await store.upsertFormTemplate({
      ...existing,
      name: body.name?.trim() || existing.name,
      description:
        body.description !== undefined
          ? body.description.trim()
          : existing.description || "",
      googleFormUrl: url,
      googleFormEmbedUrl:
        body.googleFormEmbedUrl?.trim() ||
        (url ? toGoogleFormEmbedUrl(url) : existing.googleFormEmbedUrl),
      fields,
      mode,
      updatedAt: new Date().toISOString(),
    });

    return { template };
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getFormTemplate(id);
    if (!existing) throw jsonError("Form template not found", 404);

    await store.deleteFormTemplate(id);
    return { ok: true };
  });
}
