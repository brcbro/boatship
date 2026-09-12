import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const projectId = new URL(req.url).searchParams.get("projectId");
    return { policies: await getPrisma().definitionOfDonePolicy.findMany({ where: projectId ? { projectId } : undefined, orderBy: { updatedAt: "desc" } }) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.projectId !== "string" || !body.projectId.trim()) throw jsonError("projectId is required", 400);
    const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    const policy = await getPrisma().definitionOfDonePolicy.create({ data: { id: randomUUID(), projectId: body.projectId.trim(), repositoryId: typeof body.repositoryId === "string" ? body.repositoryId : null, taskType: typeof body.taskType === "string" ? body.taskType : null, requiredFiles: list(body.requiredFiles), requiredChecks: list(body.requiredChecks), requiredBuild: Boolean(body.requiredBuild), requiredScreenshot: Boolean(body.requiredScreenshot), requiredApproval: Boolean(body.requiredApproval), allowedPaths: list(body.allowedPaths), maxStaleHours: typeof body.maxStaleHours === "number" ? Math.max(0, body.maxStaleHours) : 72, createdBy: session.uid } });
    return { policy };
  });
}
