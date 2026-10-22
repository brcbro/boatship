import { randomUUID } from "crypto";
import { Collection, nowIso, type FsData } from "@/lib/firestore";
import { GIT_EVIDENCE } from "@/lib/git-repositories";
import type { GitChangedFile, GitValidationEvidence, GitValidationRequest } from "@/lib/git-validation-types";

export type QualityPolicy = { id: string; requiredFiles: string[]; requiredChecks: string[]; requiredBuild: boolean; requiredScreenshot: boolean; requiredApproval: boolean; allowedPaths: string[]; maxStaleHours: number };

/** Firestore documents for quality gates; timestamps are ISO-8601 strings. */
export type DefinitionOfDonePolicyDoc = {
  id: string; projectId: string; repositoryId: string | null; taskType: string | null; requiredFiles: string[]; requiredChecks: string[];
  requiredBuild: boolean; requiredScreenshot: boolean; requiredApproval: boolean; allowedPaths: string[]; maxStaleHours: number;
  createdBy: string; createdAt: string; updatedAt: string;
};
export const DEFINITION_OF_DONE_POLICIES = new Collection<DefinitionOfDonePolicyDoc>("DefinitionOfDonePolicy");

export type GitValidationRunDoc = {
  id: string; taskId: string; status: string; reason: string | null; evidence: FsData; triggeredBy: string | null; source: string; createdAt: string; updatedAt: string;
};
export const GIT_VALIDATION_RUNS = new Collection<GitValidationRunDoc>("GitValidationRun");

/** Document id is the taskId (one approval per task); `id` keeps its own value. */
export type TaskManagerApprovalDoc = {
  id: string; taskId: string; reviewerId: string; status: string; note: string | null; createdAt: string; reviewedAt: string | null;
};
export const TASK_MANAGER_APPROVALS = new Collection<TaskManagerApprovalDoc>("TaskManagerApproval");

export const byUpdatedAtDesc = <T extends { updatedAt: string }>(a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
export const byCreatedAtDesc = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/**
 * Policies for a project, newest first, keeping those that apply to the
 * task type (or any type) and, when a repository is given, to that
 * repository (or any repository). Mirrors the former OR/AND SQL filter.
 */
export async function listApplicablePolicies(projectId: string, taskType?: string, repositoryId?: string) {
  const rows = await DEFINITION_OF_DONE_POLICIES.find([{ field: "projectId", op: "==", value: projectId }]);
  return rows
    // Prisma treated `{ taskType: undefined }` as no condition, so without a task type every policy applies.
    .filter((row) => !taskType || row.taskType === null || row.taskType === taskType)
    .filter((row) => !repositoryId || row.repositoryId === null || row.repositoryId === repositoryId)
    .sort(byUpdatedAtDesc);
}

export async function getPolicy(projectId: string, taskType?: string, repositoryId?: string) {
  const rows = await listApplicablePolicies(projectId, taskType, repositoryId);
  return rows[0] as QualityPolicy | undefined;
}

export function evaluateQuality(policy: QualityPolicy | undefined, changedFiles: GitChangedFile[], checks: Array<{ name: string; status: string }>, now = new Date()) {
  if (!policy) return { missing: [], scopeDrift: [], stale: false, suspicious: changedFiles.length === 0, passed: true };
  const missing = policy.requiredFiles.filter((required) => !changedFiles.some((file) => file.path === required || file.path.startsWith(`${required}/`)));
  const missingChecks = policy.requiredChecks.filter((required) => !checks.some((check) => check.name === required && check.status === "passed"));
  missing.push(...missingChecks.map((name) => `check:${name}`));
  if (policy.requiredBuild && !checks.some((check) => check.name === "build" && check.status === "passed")) missing.push("check:build");
  const scopeDrift = policy.allowedPaths.length ? changedFiles.filter((file) => !policy.allowedPaths.some((prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`))).map((file) => file.path) : [];
  const capturedAt = now.getTime();
  const stale = policy.maxStaleHours > 0 && capturedAt - now.getTime() > policy.maxStaleHours * 3600000;
  return { missing, scopeDrift, stale, suspicious: changedFiles.length === 0, passed: missing.length === 0 && scopeDrift.length === 0 && !stale && changedFiles.length > 0 };
}

export function qualityChecks() {
  return ["secret-scan", "dependency-scan", "deployment-preview", "deployment-production"] as const;
}

export async function createValidationRun(input: { taskId: string; status: string; reason?: string | null; evidence: FsData; triggeredBy?: string | null; source: string }) {
  const stamp = nowIso();
  const run: GitValidationRunDoc = { id: randomUUID(), taskId: input.taskId, status: input.status, reason: input.reason ?? null, evidence: input.evidence, triggeredBy: input.triggeredBy ?? null, source: input.source, createdAt: stamp, updatedAt: stamp };
  await GIT_VALIDATION_RUNS.create(run.id, run);
  return run;
}

export async function persistValidation(taskId: string, evidence: GitValidationEvidence, request: GitValidationRequest, triggeredBy?: string) {
  return createValidationRun({ taskId, status: evidence.status, reason: evidence.reason, evidence: evidence as unknown as FsData, triggeredBy, source: request.source || "manual" });
}

export async function getTaskQuality(taskId: string) {
  const [runs, evidence, approval] = await Promise.all([
    GIT_VALIDATION_RUNS.find([{ field: "taskId", op: "==", value: taskId }]).then((rows) => rows.sort(byCreatedAtDesc).slice(0, 20)),
    GIT_EVIDENCE.find([{ field: "taskId", op: "==", value: taskId }]).then((rows) => rows.sort(byCreatedAtDesc).slice(0, 50)),
    TASK_MANAGER_APPROVALS.get(taskId),
  ]);
  return { runs, evidence, approval };
}
