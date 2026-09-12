import { randomUUID } from "crypto";
import { getPrisma } from "@/lib/prisma";
import type { GitChangedFile, GitValidationEvidence, GitValidationRequest } from "@/lib/git-validation-types";

export type QualityPolicy = { id: string; requiredFiles: string[]; requiredChecks: string[]; requiredBuild: boolean; requiredScreenshot: boolean; requiredApproval: boolean; allowedPaths: string[]; maxStaleHours: number };

export async function getPolicy(projectId: string, taskType?: string, repositoryId?: string) {
  const rows = await getPrisma().definitionOfDonePolicy.findMany({ where: { projectId, OR: [{ taskType: null }, { taskType: taskType || undefined }], AND: repositoryId ? [{ OR: [{ repositoryId: null }, { repositoryId }] }] : undefined }, orderBy: { updatedAt: "desc" } });
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

export async function persistValidation(taskId: string, evidence: GitValidationEvidence, request: GitValidationRequest, triggeredBy?: string) {
  const prisma = getPrisma();
  return prisma.gitValidationRun.create({ data: { id: randomUUID(), taskId, status: evidence.status, reason: evidence.reason, evidence: evidence as never, triggeredBy, source: request.source || "manual" } });
}

export async function getTaskQuality(taskId: string) {
  const prisma = getPrisma();
  const [runs, evidence, approval] = await Promise.all([
    prisma.gitValidationRun.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.gitEvidence.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.taskManagerApproval.findUnique({ where: { taskId } }),
  ]);
  return { runs, evidence, approval };
}
