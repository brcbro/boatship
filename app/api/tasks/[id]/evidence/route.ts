import { handleApi } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { getTaskQuality } from "@/lib/git-quality";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task || !canAccessClient(session, task.clientId)) return { evidence: [], runs: [], approval: null };
    return getTaskQuality(id);
  });
}
