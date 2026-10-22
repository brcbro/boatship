import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { nowIso } from "@/lib/firestore";
import { GIT_REPOSITORIES, GIT_TASK_LINKS, gitTaskLinkId, type GitTaskLinkDoc } from "@/lib/git-repositories";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { taskEngagementClosed } from "@/lib/engagements";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    const rows = await GIT_TASK_LINKS.find([{ field: "taskId", op: "==", value: id }]);
    const repositories = new Map((await GIT_REPOSITORIES.getMany(rows.map((row) => row.repositoryId))).map((repo) => [repo.id, repo]));
    // Mirrors the former inner join: links whose repository is gone are dropped.
    const links = rows.flatMap((row) => {
      const repo = repositories.get(row.repositoryId);
      return repo ? [{ ...row, repository: { id: repo.id, provider: repo.provider, name: repo.name, owner: repo.owner, repository: repo.repository, defaultBranch: repo.defaultBranch } }] : [];
    });
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
    if (await taskEngagementClosed(task)) throw jsonError("Engagement is closed", 409);
    const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId : "";
    if (!repositoryId) throw jsonError("repositoryId is required", 400);
    const linkId = gitTaskLinkId(id, repositoryId);
    const existing = await GIT_TASK_LINKS.get(linkId);
    const stamp = nowIso();
    const link: GitTaskLinkDoc = { id: linkId, taskId: id, repositoryId, branch: typeof body.branch === "string" ? body.branch : null, pullRequestUrl: typeof body.pullRequestUrl === "string" ? body.pullRequestUrl : null, pullRequestId: typeof body.pullRequestId === "string" ? body.pullRequestId : null, baseSha: typeof body.baseSha === "string" ? body.baseSha : null, headSha: typeof body.headSha === "string" ? body.headSha : null, createdAt: existing?.createdAt || stamp, updatedAt: stamp };
    await GIT_TASK_LINKS.set(linkId, link);
    await (await getStore()).addActivity({ clientId: task.clientId, actorId: session.uid, actorName: session.name, action: "task.git_linked", meta: { taskId: id, repositoryId, pullRequestUrl: link.pullRequestUrl } });
    return { link };
  });
}
