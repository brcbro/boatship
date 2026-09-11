import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canManageTemplates } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { TemplatePublishStatus, TemplateTask } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const template = await store.getTemplate(id);
    if (!template) throw jsonError("Template not found", 404);
    return { template };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getTemplate(id);
    if (!existing) throw jsonError("Template not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      taskList?: TemplateTask[];
      publishStatus?: TemplatePublishStatus;
      industry?: string | null;
    };

    const publishStatus =
      body.publishStatus !== undefined ? body.publishStatus : existing.publishStatus;
    if (
      body.publishStatus !== undefined &&
      !["draft", "published", "archived"].includes(body.publishStatus)
    ) {
      throw jsonError("Invalid publishStatus", 400);
    }

    const industry =
      body.industry !== undefined
        ? body.industry === null || body.industry === ""
          ? null
          : String(body.industry).trim()
        : existing.industry;

    const template = await store.upsertTemplate({
      ...existing,
      name: body.name?.trim() || existing.name,
      description:
        body.description !== undefined
          ? body.description.trim()
          : existing.description || "",
      taskList: (body.taskList ?? existing.taskList).map((t) => ({
        ...t,
        section: t.section?.trim() || "General",
      })),
      publishStatus,
      industry,
      updatedAt: new Date().toISOString(),
    });

    return { template };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!canManageTemplates(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getTemplate(id);
    if (!existing) throw jsonError("Template not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      archivePrevious?: boolean;
    };

    const action = (body.action || "").toLowerCase();
    if (action !== "publish" && action !== "duplicate") {
      throw jsonError('action must be "publish" or "duplicate"', 400);
    }

    const now = new Date().toISOString();

    if (action === "duplicate") {
      const template = await store.upsertTemplate({
        id: randomUUID(),
        name: `${existing.name} (draft)`,
        description: existing.description || "",
        taskList: existing.taskList.map((t) => ({ ...t })),
        version: 1,
        publishStatus: "draft",
        parentTemplateId: existing.id,
        industry: existing.industry,
        createdAt: now,
        updatedAt: now,
      });
      return { template };
    }

    // publish: bump version, set published; optionally archive previous published in lineage
    let version = existing.version || 1;
    if (existing.publishStatus === "draft" && existing.parentTemplateId) {
      const parent = await store.getTemplate(existing.parentTemplateId);
      version = (parent?.version || existing.version || 0) + 1;
    } else if (existing.publishStatus === "published" || existing.publishStatus === "archived") {
      version = (existing.version || 1) + 1;
    }

    if (body.archivePrevious !== false) {
      const all = await store.listTemplates();
      const lineageRoot = existing.parentTemplateId || existing.id;
      for (const t of all) {
        if (t.id === existing.id) continue;
        if (t.publishStatus !== "published") continue;
        const tRoot = t.parentTemplateId || t.id;
        const related =
          t.id === lineageRoot ||
          t.parentTemplateId === lineageRoot ||
          tRoot === lineageRoot ||
          existing.parentTemplateId === t.id;
        if (related) {
          await store.upsertTemplate({
            ...t,
            publishStatus: "archived",
            updatedAt: now,
          });
        }
      }
    }

    const template = await store.upsertTemplate({
      ...existing,
      name: existing.name.replace(/\s*\(draft\)\s*$/i, "").trim() || existing.name,
      version,
      publishStatus: "published",
      updatedAt: now,
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
    const existing = await store.getTemplate(id);
    if (!existing) throw jsonError("Template not found", 404);

    await store.deleteTemplate(id);
    return { ok: true };
  });
}
