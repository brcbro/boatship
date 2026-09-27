import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import type { AssignedRole, TaskStatus, TaskType } from "@/types";
import { appBaseUrl, syncClientStatusFromTasks } from "@/lib/client-status";
import { sendEmail, taskAssignedEmailHtml } from "@/lib/email";
import { ensureLegacyEngagement, taskEngagementId, localClientDemo, legacyEngagementId } from "@/lib/engagements";
import { getPrisma } from "@/lib/prisma";

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
    await ensureLegacyEngagement(client);

    let tasks = await store.listTasks(clientId);
    const engagementId = new URL(req.url).searchParams.get("engagementId");
    if (engagementId) {
      if (localClientDemo()) {
        if (engagementId !== legacyEngagementId(clientId)) throw jsonError("Engagement not found", 404);
      } else {
        const engagement = await getPrisma().engagement.findUnique({ where: { id: engagementId } });
        if (!engagement || engagement.clientId !== clientId) throw jsonError("Engagement not found", 404);
      }
      tasks = tasks.filter((task) => taskEngagementId(task) === engagementId);
    }
    tasks = tasks.map((task) => ({ ...task, engagementId: taskEngagementId(task) }));
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
      engagementId?: string;
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
    await ensureLegacyEngagement(client);
    let engagementType = "onboarding";
    if (body.engagementId !== undefined) {
      if (typeof body.engagementId !== "string") throw jsonError("Invalid engagementId", 400);
      if (localClientDemo()) {
        if (body.engagementId !== legacyEngagementId(body.clientId)) throw jsonError("Engagement not found", 404);
      } else {
        const engagement = await getPrisma().engagement.findUnique({ where: { id: body.engagementId } });
        if (!engagement || engagement.clientId !== body.clientId) throw jsonError("Engagement not found", 404);
        if (engagement.status === "completed" || engagement.status === "cancelled") throw jsonError("Engagement is closed", 400);
        engagementType = engagement.type;
      }
    }

    const existingTasks = await store.listTasks(body.clientId);
    const order =
      body.order ??
      (existingTasks.length ? Math.max(...existingTasks.map((t) => t.order)) + 1 : 1);

    const task = await store.createTask({
      clientId: body.clientId,
      engagementId: body.engagementId,
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
          subject: `New ${engagementType === "onboarding" ? "onboarding" : "project"} task: ${task.title}`,
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
