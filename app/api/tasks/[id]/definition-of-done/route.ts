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
    const task = await (await getStore()).getTask((await params).id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    return { policy: await getPrisma().definitionOfDonePolicy.findFirst({ where: { projectId: task.clientId, OR: [{ taskType: null }, { taskType: task.type }] }, orderBy: { updatedAt: "desc" } }) };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const task = await (await getStore()).getTask((await params).id);
    if (!task) throw jsonError("Task not found", 404);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    const policy = await getPrisma().definitionOfDonePolicy.create({ data: { id: randomUUID(), projectId: task.clientId, taskType: typeof body.taskType === "string" ? body.taskType : task.type, repositoryId: typeof body.repositoryId === "string" ? body.repositoryId : null, requiredFiles: strings(body.requiredFiles), requiredChecks: strings(body.requiredChecks), requiredBuild: Boolean(body.requiredBuild), requiredScreenshot: Boolean(body.requiredScreenshot), requiredApproval: Boolean(body.requiredApproval), allowedPaths: strings(body.allowedPaths), maxStaleHours: typeof body.maxStaleHours === "number" ? body.maxStaleHours : 72, createdBy: session.uid } });
    return { policy };
  });
}
