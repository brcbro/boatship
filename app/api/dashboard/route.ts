import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { evaluateOnboardingHealth } from "@/lib/onboarding-health";
import { getStore } from "@/lib/store";
import { filterAssignedClients } from "@/lib/client-access";
import { calcProgress } from "@/lib/utils";
import type { ClientStatus, ClientWithProgress } from "@/types";

export const runtime = "nodejs";

/**
 * Dashboard-specific read model. This replaces three browser requests (and
 * three session validations) with one Worker invocation. The first store read
 * warms the request-local snapshot cache; the remaining collection reads do
 * not fetch StoreSnapshot again.
 */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const store = await getStore();

    // Deliberately await the first snapshot-backed read before the others.
    // Concurrent cold reads could otherwise each fetch the same JSON document.
    const allClients = await filterAssignedClients(session, await store.listClients());
    const visibleIds = new Set(allClients.map((client) => client.id));
    const [users, allTasks, allForms, allDocuments] = await Promise.all([
      store.listUsers(),
      store.listAllTasks(),
      store.listAllForms(),
      store.listAllDocuments(),
    ]);
    const tasks = allTasks.filter((task) => visibleIds.has(task.clientId));
    const forms = allForms.filter((form) => visibleIds.has(form.clientId));
    const documents = allDocuments.filter((document) => visibleIds.has(document.clientId));

    const tasksByClient = new Map<string, typeof tasks>();
    const formsByClient = new Map<string, typeof forms>();
    const documentsByClient = new Map<string, typeof documents>();
    for (const task of tasks) {
      const entries = tasksByClient.get(task.clientId) || [];
      entries.push(task);
      tasksByClient.set(task.clientId, entries);
    }
    for (const form of forms) {
      const entries = formsByClient.get(form.clientId) || [];
      entries.push(form);
      formsByClient.set(form.clientId, entries);
    }
    for (const document of documents) {
      const entries = documentsByClient.get(document.clientId) || [];
      entries.push(document);
      documentsByClient.set(document.clientId, entries);
    }

    const userMap = new Map(users.map((user) => [user.uid, user]));
    const clients: ClientWithProgress[] = allClients
      .map((client) => {
        const clientTasks = tasksByClient.get(client.id) || [];
        const completedTasks = clientTasks.filter((task) => task.status === "completed").length;
        return {
          ...client,
          totalTasks: clientTasks.length,
          completedTasks,
          progress: calcProgress(completedTasks, clientTasks.length),
          assignedTeamMemberName: client.assignedTeamMemberId
            ? userMap.get(client.assignedTeamMemberId)?.name || null
            : null,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);

    const health = allClients.map((client) =>
      evaluateOnboardingHealth(
        client,
        tasksByClient.get(client.id) || [],
        formsByClient.get(client.id) || [],
        documentsByClient.get(client.id) || []
      )
    );

    const clientsByStatus: Record<ClientStatus, number> = {
      not_started: 0,
      in_progress: 0,
      completed: 0,
      on_hold: 0,
    };
    for (const client of allClients) clientsByStatus[client.status] += 1;

    const completedClients = allClients.filter((client) => client.status === "completed");
    const avgOnboardingDays = completedClients.length
      ? Math.round(
          (completedClients.reduce(
            (sum, client) =>
              sum + (new Date(client.updatedAt).getTime() - new Date(client.createdAt).getTime()),
            0
          ) /
            completedClients.length /
            (1000 * 60 * 60 * 24)) *
            10
        ) / 10
      : 0;
    const currentTime = Date.now();
    const overdueTasks = tasks.filter(
      (task) =>
        task.dueDate &&
        task.status !== "completed" &&
        new Date(task.dueDate).getTime() < currentTime
    ).length;

    return {
      analytics: {
        totalClients: allClients.length,
        clientsByStatus,
        overdueTasks,
        avgOnboardingDays,
        teamCount: users.filter((user) => user.role === "admin" || user.role === "team").length,
      },
      clients,
      health,
    };
  });
}
