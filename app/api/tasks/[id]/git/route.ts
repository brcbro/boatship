import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    const links = await getPrisma().gitTaskLink.findMany({ where: { taskId: id }, include: { repository: { select: { id: true, provider: true, name: true, owner: true, repository: true, defaultBranch: true } } } });
    return { links };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId : "";
    if (!repositoryId) throw jsonError("repositoryId is required", 400);
    const link = await getPrisma().gitTaskLink.upsert({ where: { taskId_repositoryId: { taskId: id, repositoryId } }, create: { id: randomUUID(), taskId: id, repositoryId, branch: typeof body.branch === "string" ? body.branch : null, pullRequestUrl: typeof body.pullRequestUrl === "string" ? body.pullRequestUrl : null, pullRequestId: typeof body.pullRequestId === "string" ? body.pullRequestId : null, baseSha: typeof body.baseSha === "string" ? body.baseSha : null, headSha: typeof body.headSha === "string" ? body.headSha : null }, update: { branch: typeof body.branch === "string" ? body.branch : null, pullRequestUrl: typeof body.pullRequestUrl === "string" ? body.pullRequestUrl : null, pullRequestId: typeof body.pullRequestId === "string" ? body.pullRequestId : null, baseSha: typeof body.baseSha === "string" ? body.baseSha : null, headSha: typeof body.headSha === "string" ? body.headSha : null } });
    await (await getStore()).addActivity({ clientId: task.clientId, actorId: session.uid, actorName: session.name, action: "task.git_linked", meta: { taskId: id, repositoryId, pullRequestUrl: link.pullRequestUrl } });
    return { link };
  });
}
