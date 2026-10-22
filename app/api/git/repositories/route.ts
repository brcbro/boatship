import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createRepository, GIT_REPOSITORIES, parseRepositoryUrl, repositorySummary } from "@/lib/git-repositories";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const repositories = (await GIT_REPOSITORIES.find([{ field: "active", op: "==", value: true }]))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(repositorySummary);
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
