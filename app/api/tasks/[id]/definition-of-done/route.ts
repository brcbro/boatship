import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { nowIso } from "@/lib/firestore";
import { DEFINITION_OF_DONE_POLICIES, listApplicablePolicies, type DefinitionOfDonePolicyDoc } from "@/lib/git-quality";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { taskEngagementClosed } from "@/lib/engagements";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const task = await (await getStore()).getTask((await params).id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    return { policy: (await listApplicablePolicies(task.clientId, task.type))[0] ?? null };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const task = await (await getStore()).getTask((await params).id);
    if (!task) throw jsonError("Task not found", 404);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (await taskEngagementClosed(task)) throw jsonError("Engagement is closed", 409);
    const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    const stamp = nowIso();
    const policy: DefinitionOfDonePolicyDoc = { id: randomUUID(), projectId: task.clientId, taskType: typeof body.taskType === "string" ? body.taskType : task.type, repositoryId: typeof body.repositoryId === "string" ? body.repositoryId : null, requiredFiles: strings(body.requiredFiles), requiredChecks: strings(body.requiredChecks), requiredBuild: Boolean(body.requiredBuild), requiredScreenshot: Boolean(body.requiredScreenshot), requiredApproval: Boolean(body.requiredApproval), allowedPaths: strings(body.allowedPaths), maxStaleHours: typeof body.maxStaleHours === "number" ? body.maxStaleHours : 72, createdBy: session.uid, createdAt: stamp, updatedAt: stamp };
    await DEFINITION_OF_DONE_POLICIES.create(policy.id, policy);
    return { policy };
  });
}
