import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const clients = await store.listClients();
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const events: Array<{
      taskId: string;
      title: string;
      clientId: string;
      clientName: string;
      status: string;
      dueDate: string;
      type: string;
      assignedRole: string;
    }> = [];

    for (const client of clients) {
      const tasks = await store.listTasks(client.id);
      for (const task of tasks) {
        if (!task.dueDate) continue;
        events.push({
          taskId: task.id,
          title: task.title,
          clientId: client.id,
          clientName: clientMap.get(client.id)?.name || client.name,
          status: task.status,
          dueDate: task.dueDate,
          type: task.type,
          assignedRole: task.assignedRole,
        });
      }
    }

    events.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { events };
  });
}
