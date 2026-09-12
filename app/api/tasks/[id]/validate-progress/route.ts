import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { validateGitProgress } from "@/lib/git-validation";
import { canAccessClient, isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { getPolicy, evaluateQuality, persistValidation } from "@/lib/git-quality";
import type { GitCheckName, GitValidationRequest } from "@/lib/git-validation-types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };
const allowedChecks = new Set<GitCheckName>(["git-diff-check", "typecheck", "lint", "test", "build", "secret-scan", "dependency-scan", "deployment-preview", "deployment-production"]);

function parseRequest(value: unknown): GitValidationRequest {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const checks = Array.isArray(raw.checks)
    ? raw.checks.filter((check): check is GitCheckName => typeof check === "string" && allowedChecks.has(check as GitCheckName))
    : undefined;
  return {
    repositoryPath: typeof raw.repositoryPath === "string" ? raw.repositoryPath : undefined,
    repositoryUrl: typeof raw.repositoryUrl === "string" ? raw.repositoryUrl : undefined,
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    baseSha: typeof raw.baseSha === "string" ? raw.baseSha : undefined,
    headSha: typeof raw.headSha === "string" ? raw.headSha : undefined,
    checks,
  };
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const task = await store.getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    if (!isStaff(session.role) && task.assignedTo !== session.uid) throw jsonError("Only the assigned user can validate this task", 403);

    const request = parseRequest(await req.json().catch(() => ({})));
    let evidence = await validateGitProgress(id, request);
    const policy = await getPolicy(task.clientId, task.type);
    if (policy) {
      const quality = evaluateQuality(policy, evidence.changedFiles, evidence.checks);
      evidence = {
        ...evidence,
        status: evidence.status === "blocked" ? "blocked" : quality.passed ? evidence.status : "failed",
        reason: evidence.reason || (quality.missing.length ? `Definition of done missing: ${quality.missing.join(", ")}` : undefined),
        quality: {
          scopeDrift: quality.scopeDrift,
          stale: quality.stale,
          suspicious: quality.suspicious,
          secretScan: evidence.checks.find((check) => check.name === "secret-scan") || { name: "secret-scan", status: "blocked", exitCode: null, output: "Run secret-scan to verify added lines." },
          dependencyScan: evidence.checks.find((check) => check.name === "dependency-scan") || { name: "dependency-scan", status: "blocked", exitCode: null, output: "Run dependency-scan to verify lockfile changes." },
          deployment: evidence.checks.find((check) => check.name === "deployment-production") || { name: "deployment-production", status: "blocked", exitCode: null, output: "Deployment verification requires a deployment webhook." },
          policy: { id: policy.id, missing: quality.missing, passed: quality.passed },
          managerApproval: policy.requiredApproval ? "pending" : "not_required",
        },
      };
    }
    await persistValidation(id, evidence, request, session.uid);
    await store.addActivity({
      clientId: task.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "task.progress_validated",
      meta: { taskId: id, evidence },
    });
    return { evidence };
  });
}
