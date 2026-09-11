import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { normalizeFormFields } from "@/lib/form-fields";
import { toGoogleFormEmbedUrl, isGoogleFormsUrl } from "@/lib/google-forms";
import { canManageTemplates } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { FormTemplate } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireSession(req);
    const store = await getStore();
    const templates = await store.listFormTemplates();
    return { templates };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      description?: string;
      googleFormUrl?: string;
      googleFormEmbedUrl?: string;
      mode?: "google" | "native";
      fields?: unknown;
    };

    if (!body.name?.trim()) throw jsonError("name is required", 400);

    const fields = normalizeFormFields(body.fields);
    const mode: FormTemplate["mode"] =
      body.mode === "native" || (body.mode !== "google" && fields.length > 0)
        ? "native"
        : "google";

    const url = body.googleFormUrl?.trim() || "";
    if (mode === "google") {
      if (!url) throw jsonError("googleFormUrl is required", 400);
      if (!isGoogleFormsUrl(url)) {
        throw jsonError("URL must be a Google Forms link (docs.google.com/forms/...)", 400);
      }
    } else if (url && !isGoogleFormsUrl(url)) {
      throw jsonError("URL must be a Google Forms link (docs.google.com/forms/...)", 400);
    }

    const store = await getStore();
    const now = new Date().toISOString();
    const existing = body.id ? await store.getFormTemplate(body.id) : null;

    const template = await store.upsertFormTemplate({
      id: body.id || randomUUID(),
      name: body.name.trim(),
      description: body.description?.trim() || "",
      googleFormUrl: url,
      googleFormEmbedUrl:
        body.googleFormEmbedUrl?.trim() ||
        (url ? toGoogleFormEmbedUrl(url) : undefined),
      fields,
      mode,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    return { template };
  });
}
