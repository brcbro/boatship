import { handleApi, jsonError } from "@/lib/api";
import { getSessionFromRequest } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { isApprovalReviewer } from "@/lib/mcp-controls";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    if (!session || !isApprovalReviewer(session)) throw jsonError("Manager or admin access required", 403);
    const status = new URL(req.url).searchParams.get("status") || "pending";
    const approvals = await getPrisma().taskManagerApproval.findMany({ where: status === "all" ? undefined : { status }, orderBy: { createdAt: "desc" } });
    const store = await getStore();
    const tasks = await store.listAllTasks();
    const clients = await store.listClients();
    return { approvals: approvals.map((approval) => { const task = tasks.find((item) => item.id === approval.taskId); const client = task ? clients.find((item) => item.id === task.clientId) : null; return { ...approval, task: task ? { id: task.id, title: task.title, status: task.status, clientId: task.clientId } : null, client: client ? { id: client.id, companyName: client.companyName, name: client.name } : null }; }) };
  });
}
