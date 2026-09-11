import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canManageTemplates } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { TemplateTask } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireSession(req);
    const store = await getStore();
    const templates = await store.listTemplates();
    return { templates };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      taskList?: TemplateTask[];
      industry?: string | null;
    };

    if (!body.name?.trim()) throw jsonError("name is required", 400);

    const now = new Date().toISOString();
    const store = await getStore();
    const template = await store.upsertTemplate({
      id: randomUUID(),
      name: body.name.trim(),
      description: body.description?.trim() || "",
      taskList: (body.taskList || []).map((t) => ({
        ...t,
        section: t.section?.trim() || "General",
      })),
      version: 1,
      publishStatus: "draft",
      parentTemplateId: null,
      industry:
        body.industry === null || body.industry === undefined || body.industry === ""
          ? null
          : String(body.industry).trim(),
      createdAt: now,
      updatedAt: now,
    });

    return { template };
  });
}
