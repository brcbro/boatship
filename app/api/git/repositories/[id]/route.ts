import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { isFirestoreStatus, nowIso } from "@/lib/firestore";
import { GIT_REPOSITORIES, syncRepositoryMetadata } from "@/lib/git-repositories";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const { id } = await params;
    try {
      await GIT_REPOSITORIES.update(id, { active: false, updatedAt: nowIso() }, { exists: true });
    } catch (error) {
      if (isFirestoreStatus(error, "NOT_FOUND")) throw jsonError("Repository not found", 404);
      throw error;
    }
    return { ok: true };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const repository = await GIT_REPOSITORIES.get(id);
    if (!repository || !repository.active) throw jsonError("Repository not found", 404);
    return { sync: await syncRepositoryMetadata({ id: repository.id, provider: repository.provider, owner: repository.owner, repository: repository.repository, accessTokenRef: repository.accessTokenRef }) };
  });
}
