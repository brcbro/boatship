import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import type { AssignedRole, TaskStatus, TaskType } from "@/types";
import { appBaseUrl, syncClientStatusFromTasks } from "@/lib/client-status";
import { sendEmail, taskAssignedEmailHtml } from "@/lib/email";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    let tasks = await store.listTasks(clientId);
    // Clients only see client_facing tasks
    if (session.role === "client") {
      tasks = tasks.filter((t) => t.type === "client_facing");
    }

    return { tasks };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      title?: string;
      description?: string;
      type?: TaskType;
      assignedTo?: string | null;
      assignedRole?: AssignedRole;
      status?: TaskStatus;
      dueDate?: string | null;
      order?: number;
      internalNotes?: string;
      formTemplateId?: string | null;
      requiresUpload?: boolean;
      section?: string;
    };

    if (!body.clientId || !body.title?.trim()) {
      throw jsonError("clientId and title are required", 400);
    }

    const store = await getStore();
    const client = await store.getClient(body.clientId);
    if (!client) throw jsonError("Client not found", 404);
    if (!await canAccessClient(session, body.clientId)) throw jsonError("Forbidden", 403);

    const existingTasks = await store.listTasks(body.clientId);
    const order =
      body.order ??
      (existingTasks.length ? Math.max(...existingTasks.map((t) => t.order)) + 1 : 1);

    const task = await store.createTask({
      clientId: body.clientId,
      title: body.title.trim(),
      description: body.description?.trim() || "",
      type: body.type || "internal",
      assignedTo: body.assignedTo ?? null,
      assignedRole: body.assignedRole || "team",
      status: body.status || "pending",
      dueDate: body.dueDate ?? null,
      order,
      section: body.section?.trim() || undefined,
      internalNotes: body.internalNotes || "",
      formTemplateId: body.formTemplateId ?? null,
      requiresUpload: Boolean(body.requiresUpload),
    });

    if (body.formTemplateId) {
      await store.createForm({
        clientId: body.clientId,
        formTemplateId: body.formTemplateId,
        taskId: task.id,
      });
    }

    await store.addActivity({
      clientId: body.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "task.created",
      meta: { taskId: task.id, title: task.title },
    });

    await syncClientStatusFromTasks(store, body.clientId);

    if (task.type === "client_facing" && client.primaryContactEmail) {
      try {
        await sendEmail({
          to: client.primaryContactEmail,
          subject: `New onboarding task: ${task.title}`,
          html: taskAssignedEmailHtml({
            name: client.name,
            taskTitle: task.title,
            link: `${appBaseUrl(req)}/portal`,
          }),
        });
      } catch (err) {
        console.error("Failed to send task assigned email", err);
      }
    }

    return { task };
  });
}
