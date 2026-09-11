import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { ClientStatus } from "@/types";

export const runtime = "nodejs";

function csvEscape(value: string | number | null | undefined) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");

  if (format === "csv") {
    try {
      await requireRoles(req, ["admin", "team"]);
      const store = await getStore();
      const clients = await store.listClients();
      const users = await store.listUsers();
      const userMap = new Map(users.map((u) => [u.uid, u]));

      const rows: string[] = [
        [
          "id",
          "name",
          "companyName",
          "email",
          "status",
          "assignee",
          "tags",
          "progress",
          "completedTasks",
          "totalTasks",
          "createdAt",
          "updatedAt",
        ].join(","),
      ];

      for (const client of clients) {
        const progress = await store.clientProgress(client.id);
        const assignee = client.assignedTeamMemberId
          ? userMap.get(client.assignedTeamMemberId)?.name || ""
          : "";
        rows.push(
          [
            csvEscape(client.id),
            csvEscape(client.name),
            csvEscape(client.companyName),
            csvEscape(client.primaryContactEmail),
            csvEscape(client.status),
            csvEscape(assignee),
            csvEscape((client.tags || []).join("; ")),
            csvEscape(progress.progress),
            csvEscape(progress.completedTasks),
            csvEscape(progress.totalTasks),
            csvEscape(client.createdAt),
            csvEscape(client.updatedAt),
          ].join(",")
        );
      }

      return new Response(rows.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="boatship-clients.csv"',
        },
      });
    } catch (err) {
      if (err instanceof Response) return err;
      const message = err instanceof Error ? err.message : "Unexpected error";
      return jsonError(message, 500);
    }
  }

  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const clients = await store.listClients();
    const users = await store.listUsers();

    const clientsByStatus: Record<ClientStatus, number> = {
      not_started: 0,
      in_progress: 0,
      completed: 0,
      on_hold: 0,
    };
    for (const c of clients) {
      clientsByStatus[c.status] = (clientsByStatus[c.status] || 0) + 1;
    }

    // Average onboarding time (days) for completed clients
    const completedClients = clients.filter((c) => c.status === "completed");
    let avgOnboardingDays = 0;
    if (completedClients.length) {
      const totalMs = completedClients.reduce((sum, c) => {
        return sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime());
      }, 0);
      avgOnboardingDays =
        Math.round((totalMs / completedClients.length / (1000 * 60 * 60 * 24)) * 10) / 10;
    }

    // Overdue tasks across all clients
    const now = Date.now();
    const overdueTaskList: Array<{
      taskId: string;
      title: string;
      clientId: string;
      clientName?: string;
      dueDate: string;
    }> = [];
    const recentActivity: Array<{
      id: string;
      clientId: string;
      clientName?: string;
      actorName: string;
      action: string;
      timestamp: string;
    }> = [];

    const clientNameMap = new Map(clients.map((c) => [c.id, c.name]));
    const clientUsers = users.filter((u) => u.role === "client" && u.clientId);
    const invitedClientIds = new Set(clientUsers.map((u) => u.clientId as string));

    let funnelInvited = 0;
    let funnelStarted = 0;
    let funnelCompleted = 0;
    let totalCompletedTasks = 0;
    let documentsPendingReview = 0;

    for (const client of clients) {
      const tasks = await store.listTasks(client.id);
      const completedTaskCount = tasks.filter((t) => t.status === "completed").length;
      totalCompletedTasks += completedTaskCount;

      const hasStarted = tasks.some(
        (t) => t.status === "in_progress" || t.status === "completed"
      );
      const isInvited = invitedClientIds.has(client.id);
      if (isInvited) funnelInvited += 1;
      if (hasStarted) funnelStarted += 1;
      if (client.status === "completed") funnelCompleted += 1;

      for (const task of tasks) {
        if (
          task.dueDate &&
          task.status !== "completed" &&
          new Date(task.dueDate).getTime() < now
        ) {
          overdueTaskList.push({
            taskId: task.id,
            title: task.title,
            clientId: client.id,
            clientName: clientNameMap.get(client.id),
            dueDate: task.dueDate,
          });
        }
      }

      const docs = await store.listDocuments(client.id);
      documentsPendingReview += docs.filter((d) => d.status === "pending_review").length;

      const activity = await store.listActivity(client.id);
      for (const entry of activity.slice(0, 10)) {
        recentActivity.push({
          id: entry.id,
          clientId: entry.clientId,
          clientName: clientNameMap.get(entry.clientId),
          actorName: entry.actorName,
          action: entry.action,
          timestamp: entry.timestamp,
        });
      }
    }

    overdueTaskList.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    recentActivity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const avgTasksCompleted =
      clients.length > 0
        ? Math.round((totalCompletedTasks / clients.length) * 10) / 10
        : 0;

    return {
      avgOnboardingDays,
      clientsByStatus,
      overdueTasks: overdueTaskList.length,
      overdueTaskList,
      totalClients: clients.length,
      teamCount: users.filter((u) => u.role === "admin" || u.role === "team").length,
      recentActivity: recentActivity.slice(0, 25),
      funnel: {
        invited: funnelInvited,
        started: funnelStarted,
        completed: funnelCompleted,
      },
      avgTasksCompleted,
      documentsPendingReview,
    };
  });
}
