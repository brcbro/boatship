import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { syncRepositoryMetadata } from "@/lib/git-repositories";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const { id } = await params;
    const count = await getPrisma().$executeRaw`UPDATE "GitRepositoryConnection" SET "active" = false, "updatedAt" = NOW() WHERE "id" = ${id}`;
    if (!count) throw jsonError("Repository not found", 404);
    return { ok: true };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const repository = await getPrisma().gitRepositoryConnection.findUnique({ where: { id }, select: { id: true, provider: true, owner: true, repository: true, accessTokenRef: true, active: true } });
    if (!repository || !repository.active) throw jsonError("Repository not found", 404);
    return { sync: await syncRepositoryMetadata(repository) };
  });
}
