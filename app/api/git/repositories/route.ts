import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createRepository, parseRepositoryUrl } from "@/lib/git-repositories";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const repositories = await getPrisma().gitRepositoryConnection.findMany({ where: { active: true }, select: { id: true, provider: true, name: true, owner: true, repository: true, defaultBranch: true, active: true, createdBy: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" } });
    return { repositories, viewer: session.uid };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = typeof body.url === "string" ? parseRepositoryUrl(body.url) : null;
    const provider = body.provider === "gitlab" ? "gitlab" : parsed?.provider || "github";
    const owner = typeof body.owner === "string" ? body.owner.trim() : parsed?.owner || "";
    const repository = typeof body.repository === "string" ? body.repository.trim() : parsed?.repository || "";
    if (!owner || !repository) throw jsonError("owner and repository are required", 400);
    const created = await createRepository({ provider, owner, repository, name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : `${owner}/${repository}`, defaultBranch: typeof body.defaultBranch === "string" ? body.defaultBranch : undefined, webhookSecret: typeof body.webhookSecret === "string" ? body.webhookSecret : undefined, accessTokenRef: typeof body.accessTokenRef === "string" ? body.accessTokenRef : undefined, createdBy: session.uid });
    return { repository: created };
  });
}
