import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { nowIso } from "@/lib/firestore";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { byUpdatedAtDesc, DEFINITION_OF_DONE_POLICIES, type DefinitionOfDonePolicyDoc } from "@/lib/git-quality";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const projectId = new URL(req.url).searchParams.get("projectId");
    if (projectId && !await canAccessClient(session, projectId)) throw jsonError("Forbidden", 403);
    const visibleIds = session.role === "team"
      ? (await filterAssignedClients(session, await (await getStore()).listClients())).map((client) => client.id)
      : null;
    const policies = projectId
      ? await DEFINITION_OF_DONE_POLICIES.find([{ field: "projectId", op: "==", value: projectId }])
      : visibleIds
        ? visibleIds.length ? await DEFINITION_OF_DONE_POLICIES.find([{ field: "projectId", op: "in", value: visibleIds }]) : []
        : await DEFINITION_OF_DONE_POLICIES.find([]);
    return { policies: policies.sort(byUpdatedAtDesc) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.projectId !== "string" || !body.projectId.trim()) throw jsonError("projectId is required", 400);
    const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
    const stamp = nowIso();
    const policy: DefinitionOfDonePolicyDoc = { id: randomUUID(), projectId: body.projectId.trim(), repositoryId: typeof body.repositoryId === "string" ? body.repositoryId : null, taskType: typeof body.taskType === "string" ? body.taskType : null, requiredFiles: list(body.requiredFiles), requiredChecks: list(body.requiredChecks), requiredBuild: Boolean(body.requiredBuild), requiredScreenshot: Boolean(body.requiredScreenshot), requiredApproval: Boolean(body.requiredApproval), allowedPaths: list(body.allowedPaths), maxStaleHours: typeof body.maxStaleHours === "number" ? Math.max(0, body.maxStaleHours) : 72, createdBy: session.uid, createdAt: stamp, updatedAt: stamp };
    await DEFINITION_OF_DONE_POLICIES.create(policy.id, policy);
    return { policy };
  });
}
