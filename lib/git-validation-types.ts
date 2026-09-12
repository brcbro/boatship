import type { Task } from "@/types";

export type GitCheckName = "git-diff-check" | "typecheck" | "lint" | "test" | "build" | "secret-scan" | "dependency-scan" | "deployment-preview" | "deployment-production";

export type GitValidationStatus = "verified" | "failed" | "blocked";

export type GitValidationRequest = {
  repositoryPath?: string;
  repositoryUrl?: string;
  branch?: string;
  baseSha?: string;
  headSha?: string;
  checks?: GitCheckName[];
  policyId?: string;
  source?: "manual" | "pull_request" | "webhook";
};

export type GitChangedFile = {
  status: string;
  path: string;
  oldPath?: string;
};

export type GitCheckResult = {
  name: GitCheckName;
  status: "passed" | "failed" | "blocked";
  exitCode: number | null;
  output?: string;
};

export type GitValidationEvidence = {
  status: GitValidationStatus;
  reason?: string;
  taskId: string;
  repository: {
    path?: string;
    url?: string;
    branch?: string;
    baseSha?: string;
    headSha?: string;
  };
  changedFiles: GitChangedFile[];
  diffHash?: string;
  checks: GitCheckResult[];
  capturedAt: string;
  quality?: {
    scopeDrift: string[];
    stale: boolean;
    suspicious: boolean;
    secretScan: GitCheckResult;
    dependencyScan: GitCheckResult;
    deployment: GitCheckResult;
    policy?: { id: string; missing: string[]; passed: boolean };
    managerApproval?: "pending" | "approved" | "rejected" | "not_required";
  };
};

export type GitValidationContext = {
  task: Task;
  request: GitValidationRequest;
};
