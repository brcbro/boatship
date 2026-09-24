import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { syncClientStatusFromTasks } from "@/lib/client-status";
import { notifyIntegrations } from "@/lib/composio";
import { canAccessClient } from "@/lib/client-access";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { dispatchWebhooks } from "@/lib/webhooks";
import { getPolicy } from "@/lib/git-quality";
import { getPrisma } from "@/lib/prisma";
import type {
  AssignedRole,
  TaskPriority,
  TaskStatus,
  TaskSubtask,
  TaskType,
} from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function normalizeSubtasks(value: unknown): TaskSubtask[] | null {
  if (!Array.isArray(value)) return null;
  const out: TaskSubtask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || !title) return null;
    out.push({
      id,
      title,
      completed: Boolean(raw.completed),
    });
  }
  return out;
}

function normalizeIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === "string")) return null;
  return value.map((v) => v.trim()).filter(Boolean);
}

function normalizePriority(value: unknown): TaskPriority | null {
  if (value === "low" || value === "medium" || value === "high" || value === "urgent") {
    return value;
  }
  return null;
}

async function assertDependenciesComplete(
  store: Awaited<ReturnType<typeof getStore>>,
  clientId: string,
  dependsOnTaskIds: string[]
) {
  if (!dependsOnTaskIds.length) return;
  const siblingTasks = await store.listTasks(clientId);
  const byId = new Map(siblingTasks.map((t) => [t.id, t]));
  const incomplete = dependsOnTaskIds.filter((depId) => {
    const dep = byId.get(depId);
    return !dep || dep.status !== "completed";
  });
  if (incomplete.length) {
    throw jsonError(
      "Cannot start or complete this task until its dependencies are completed",
      400
    );
  }
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getTask(id);
    if (!existing) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, existing.clientId)) {
      throw jsonError("Forbidden", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      type?: TaskType;
      assignedTo?: string | null;
      assignedRole?: AssignedRole;
      status?: TaskStatus;
      dueDate?: string | null;
      order?: number;
      section?: string;
      internalNotes?: string;
      formTemplateId?: string | null;
      requiresUpload?: boolean;
      subtasks?: TaskSubtask[];
      dependsOnTaskIds?: string[];
      priority?: TaskPriority;
      watcherIds?: string[];
      escalatedAt?: string | null;
    };

    async function afterTaskUpdate(
      task: NonNullable<typeof existing>,
      patch: { status?: TaskStatus }
    ) {
      await syncClientStatusFromTasks(store, task.clientId, {
        actorUid: session.uid,
      });

      if (patch.status === "completed" && existing!.status !== "completed") {
        const client = await store.getClient(task.clientId);
        if (client) {
          const notifyUid =
            session.role === "client"
              ? client.assignedTeamMemberId || session.uid
              : session.uid;
          void notifyIntegrations(notifyUid, {
            type: "task.completed",
            clientId: client.id,
            clientName: client.name,
            companyName: client.companyName,
            taskTitle: task.title,
          });
          void dispatchWebhooks("task.completed", {
            taskId: task.id,
            taskTitle: task.title,
            clientId: client.id,
            clientName: client.name,
            companyName: client.companyName,
          });
        }
      }
    }

    if (session.role === "client") {
      if (existing.type !== "client_facing") {
        throw jsonError("Forbidden", 403);
      }
      if (body.internalNotes !== undefined) {
        throw jsonError("Clients cannot set internalNotes", 403);
      }
      if (body.dependsOnTaskIds !== undefined) {
        throw jsonError("Clients cannot set dependsOnTaskIds", 403);
      }
      if (body.priority !== undefined) {
        throw jsonError("Clients cannot set priority", 403);
      }
      if (body.watcherIds !== undefined) {
        throw jsonError("Clients cannot set watcherIds", 403);
      }
      if (body.escalatedAt !== undefined) {
        throw jsonError("Clients cannot set escalatedAt", 403);
      }
      const allowedStatus: TaskStatus[] = ["pending", "in_progress", "completed"];
      if (body.status && !allowedStatus.includes(body.status)) {
        throw jsonError("Clients can only set status to pending, in_progress, or completed", 400);
      }
      const clientPatch: Partial<typeof existing> = {};
      if (body.status) clientPatch.status = body.status;
      if (body.subtasks !== undefined) {
        const subtasks = normalizeSubtasks(body.subtasks);
        if (!subtasks) throw jsonError("Invalid subtasks", 400);
        clientPatch.subtasks = subtasks;
      }
      if (Object.keys(clientPatch).length === 0) {
        throw jsonError("No allowed fields to update", 400);
      }
      if (
        clientPatch.status === "in_progress" ||
        clientPatch.status === "completed"
      ) {
        await assertDependenciesComplete(
          store,
          existing.clientId,
          existing.dependsOnTaskIds || []
        );
      }
      if (clientPatch.status === "completed") {
        const policy = await getPolicy(existing.clientId, existing.type);
        if (policy?.requiredApproval) {
          const approval = await getPrisma().taskManagerApproval.findUnique({ where: { taskId: id } });
          if (approval?.status !== "approved") {
            throw jsonError("Manager approval is required before completing this task", 409);
          }
        }
      }
      const task = await store.updateTask(id, clientPatch);
      await store.addActivity({
        clientId: existing.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "task.updated",
        meta: { taskId: id, patch: clientPatch, by: "client" },
      });
      await afterTaskUpdate(task, clientPatch);
      return { task };
    }

    if (!isStaff(session.role)) throw jsonError("Forbidden", 403);

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.description !== undefined) patch.description = body.description;
    if (body.type !== undefined) patch.type = body.type;
    if (body.assignedTo !== undefined) patch.assignedTo = body.assignedTo;
    if (body.assignedRole !== undefined) patch.assignedRole = body.assignedRole;
    if (body.status !== undefined) patch.status = body.status;
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
    if (body.order !== undefined) patch.order = body.order;
    if (body.section !== undefined) patch.section = body.section.trim() || "General";
    if (body.internalNotes !== undefined) patch.internalNotes = body.internalNotes;
    if (body.formTemplateId !== undefined) patch.formTemplateId = body.formTemplateId;
    if (body.requiresUpload !== undefined) patch.requiresUpload = body.requiresUpload;
    if (body.subtasks !== undefined) {
      const subtasks = normalizeSubtasks(body.subtasks);
      if (!subtasks) throw jsonError("Invalid subtasks", 400);
      patch.subtasks = subtasks;
    }
    if (body.dependsOnTaskIds !== undefined) {
      const deps = normalizeIdList(body.dependsOnTaskIds);
      if (!deps) throw jsonError("Invalid dependsOnTaskIds", 400);
      patch.dependsOnTaskIds = deps;
    }
    if (body.priority !== undefined) {
      const priority = normalizePriority(body.priority);
      if (!priority) throw jsonError("Invalid priority", 400);
      patch.priority = priority;
    }
    if (body.watcherIds !== undefined) {
      const watchers = normalizeIdList(body.watcherIds);
      if (!watchers) throw jsonError("Invalid watcherIds", 400);
      patch.watcherIds = watchers;
    }
    if (body.escalatedAt !== undefined) {
      if (body.escalatedAt !== null && typeof body.escalatedAt !== "string") {
        throw jsonError("Invalid escalatedAt", 400);
      }
      patch.escalatedAt = body.escalatedAt;
    }

    if (patch.status === "in_progress" || patch.status === "completed") {
      const deps =
        (patch.dependsOnTaskIds as string[] | undefined) ??
        existing.dependsOnTaskIds ??
        [];
      await assertDependenciesComplete(store, existing.clientId, deps);
    }

    if (patch.status === "completed") {
      const policy = await getPolicy(existing.clientId, existing.type);
      if (policy?.requiredApproval) {
        const approval = await getPrisma().taskManagerApproval.findUnique({ where: { taskId: id } });
        if (approval?.status !== "approved") {
          throw jsonError("Manager approval is required before completing this task", 409);
        }
      }
    }

    const task = await store.updateTask(id, patch);
    await store.addActivity({
      clientId: existing.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "task.updated",
      meta: { taskId: id, patch },
    });
    await afterTaskUpdate(task, patch as { status?: TaskStatus });
    return { task };
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getTask(id);
    if (!existing) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, existing.clientId)) throw jsonError("Forbidden", 403);

    await store.deleteTask(id);
    await store.addActivity({
      clientId: existing.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "task.deleted",
      meta: { taskId: id, title: existing.title },
    });
    await syncClientStatusFromTasks(store, existing.clientId);
    return { ok: true };
  });
}
