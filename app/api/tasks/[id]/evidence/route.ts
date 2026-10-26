import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { clientCanSeeTask } from "@/lib/client-projection";
import { getStore } from "@/lib/store";
import { getTaskQuality } from "@/lib/git-quality";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (session.role === "client") {
      // A client reads evidence only for its own client-facing tasks; any other task does not exist for it.
      if (!task || !clientCanSeeTask(task) || !await canAccessClient(session, task.clientId)) throw jsonError("Task not found", 404);
      return getTaskQuality(id);
    }
    if (!task || !await canAccessClient(session, task.clientId)) return { evidence: [], runs: [], approval: null };
    return getTaskQuality(id);
  });
}
