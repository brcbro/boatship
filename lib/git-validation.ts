import { createHash } from "crypto";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

/**
 * Checkout paths come from configuration at run time. Loading the file system
 * module outside bundle analysis keeps Turbopack from tracing the whole
 * project for these calls; validation never runs on the Worker.
 */
const checkoutFs = () => import(/* turbopackIgnore: true */ "node:fs/promises");
import {
  isGitCheckName,
  type GitChangedFile,
  type GitCheckName,
  type GitCheckResult,
  type GitValidationEvidence,
  type GitValidationRequest,
} from "@/lib/git-validation-types";

const execFileAsync = promisify(execFile);
const CHECK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_LENGTH = 4_000;

export type GitValidationAvailability =
  | { available: true; root: string }
  | { available: false; reason: string };

function onWorkersRuntime() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * Git validation runs git and npm in a local checkout, so it is only offered
 * where processes can be spawned and an operator has named the directory that
 * holds checkouts (`BOATSHIP_GIT_CHECKOUT_ROOT`). The hosted Worker has
 * neither; callers answer 501 with the reason.
 */
export function gitValidationAvailability(env: Record<string, string | undefined> = process.env): GitValidationAvailability {
  if (onWorkersRuntime() || typeof execFile !== "function") {
    return { available: false, reason: "Git validation is disabled on this hosted deployment; run it where a local checkout is available." };
  }
  const root = env.BOATSHIP_GIT_CHECKOUT_ROOT?.trim();
  if (!root) return { available: false, reason: "Git validation is disabled: BOATSHIP_GIT_CHECKOUT_ROOT is not configured." };
  if (!path.isAbsolute(root)) return { available: false, reason: "Git validation is disabled: BOATSHIP_GIT_CHECKOUT_ROOT must be an absolute path." };
  return { available: true, root };
}

/**
 * Resolves a requested checkout inside the allowlisted root. Relative paths
 * are taken from the root; no path means the root itself. Both sides are
 * resolved through symlinks before the containment check, so a link inside
 * the root that points outside it is refused. Returns null when refused.
 */
export async function resolveCheckoutPath(root: string, requested?: string): Promise<string | null> {
  if (requested !== undefined && (requested.includes("\0") || !requested.trim())) return null;
  let realRoot: string;
  let realCandidate: string;
  try {
    // Joined explicitly: path.resolve falls back to the working directory, which makes the bundler trace the whole project.
    if (!path.isAbsolute(root)) return null;
    const fs = await checkoutFs();
    realRoot = await fs.realpath(root);
    const target = requested?.trim() || ".";
    realCandidate = await fs.realpath(path.isAbsolute(target) ? target : `${realRoot}${path.sep}${target}`);
  } catch {
    return null;
  }
  const relative = path.relative(realRoot, realCandidate);
  if (relative === "") return realCandidate;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return realCandidate;
}

/** A commit-ish the caller supplied: no option-looking or control-character input reaches git. */
function safeRevision(value: string | undefined) {
  return value === undefined || /^[A-Za-z0-9][A-Za-z0-9._/@{}^~-]{0,199}$/.test(value);
}

function trimOutput(value: string) {
  return value.trim().slice(-MAX_OUTPUT_LENGTH);
}

async function git(repo: string, args: string[]) {
  const result = await execFileAsync("git", args, {
    cwd: repo,
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

function blocked(taskId: string, request: GitValidationRequest, reason: string): GitValidationEvidence {
  return {
    status: "blocked",
    reason,
    taskId,
    repository: {
      path: request.repositoryPath,
      url: request.repositoryUrl,
      branch: request.branch,
      baseSha: request.baseSha,
      headSha: request.headSha,
    },
    changedFiles: [],
    checks: [],
    capturedAt: new Date().toISOString(),
  };
}

function parseChangedFiles(raw: string): GitChangedFile[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split("\t");
      return second
        ? { status, path: second, oldPath: first }
        : { status, path: first };
    });
}

async function runCheck(repo: string, name: GitCheckName, baseSha: string, headSha: string): Promise<GitCheckResult> {
  if (name === "secret-scan" || name === "dependency-scan") {
    try {
      const diff = await git(repo, ["diff", "--unified=0", `${baseSha}..${headSha}`]);
      if (name === "secret-scan") {
        const secretPattern = /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i;
        const found = diff.split("\n").some((line) => line.startsWith("+") && !line.startsWith("+++") && secretPattern.test(line));
        return { name, status: found ? "failed" : "passed", exitCode: found ? 1 : 0, output: found ? "Potential secret detected in added lines." : "No high-confidence secret pattern found." };
      }
      const changedLockfile = diff.split("\n").some((line) => /\+\+\+ b\/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock)/.test(line));
      return { name, status: "passed", exitCode: 0, output: changedLockfile ? "Lockfile changes captured; run provider vulnerability scanning in CI for advisory results." : "No dependency lockfile changed." };
    } catch {
      return { name, status: "blocked", exitCode: null, output: "Security scan could not read the Git diff." };
    }
  }
  if (name === "deployment-preview" || name === "deployment-production") {
    return { name, status: "blocked", exitCode: null, output: "Deployment status is supplied by deployment webhooks." };
  }
  const commands: Record<GitCheckName, [string, string[]]> = {
    "git-diff-check": ["git", ["diff", "--check", `${baseSha}..${headSha}`]],
    typecheck: ["npx", ["tsc", "--noEmit", "--pretty", "false"]],
    lint: ["npm", ["run", "lint", "--", "--quiet"]],
    test: ["npm", ["test", "--", "--runInBand"]],
    build: ["npm", ["run", "build"]],
    "secret-scan": ["git", ["status"]],
    "dependency-scan": ["git", ["status"]],
    "deployment-preview": ["git", ["status"]],
    "deployment-production": ["git", ["status"]],
  };
  const [command, args] = commands[name];
  try {
    const result = await execFileAsync(command, args, {
      cwd: repo,
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return { name, status: "passed", exitCode: 0, output: trimOutput(result.stdout) };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    const output = trimOutput([failure.stdout, failure.stderr].filter(Boolean).join("\n"));
    return {
      name,
      status: "failed",
      exitCode: typeof failure.code === "number" ? failure.code : null,
      output: output || (failure.killed ? "Check timed out" : "Check failed"),
    };
  }
}

export async function validateGitProgress(
  taskId: string,
  request: GitValidationRequest
): Promise<GitValidationEvidence> {
  const availability = gitValidationAvailability();
  if (!availability.available) return blocked(taskId, request, availability.reason);
  if (request.checks?.some((name) => !isGitCheckName(name))) return blocked(taskId, request, "checks contains an unsupported check.");
  if (!safeRevision(request.baseSha) || !safeRevision(request.headSha) || !safeRevision(request.branch)) {
    return blocked(taskId, request, "Branch and commit identifiers must be plain Git revisions.");
  }
  if (!request.repositoryPath && request.repositoryUrl) {
    return blocked(taskId, request, "Repository provider access is unavailable; provide an accessible local checkout.");
  }
  const repoPath = await resolveCheckoutPath(availability.root, request.repositoryPath);
  if (!repoPath) return blocked(taskId, request, "Repository path must name a checkout inside the configured checkout root.");
  // Evidence names the checkout relative to the root, never the server's absolute layout.
  const fs = await checkoutFs();
  const displayPath = path.relative(await fs.realpath(availability.root), repoPath).split(path.sep).join("/") || ".";
  request = { ...request, repositoryPath: displayPath };

  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) throw new Error("not a directory");
    await git(repoPath, ["rev-parse", "--git-dir"]);
  } catch {
    return blocked(taskId, request, "Repository checkout is unavailable or is not a Git repository.");
  }

  let branch: string;
  let baseSha: string;
  let headSha: string;
  try {
    branch = await git(repoPath, ["branch", "--show-current"]);
    baseSha = request.baseSha ? await git(repoPath, ["rev-parse", "--verify", `${request.baseSha}^{commit}`]) : "";
    headSha = request.headSha
      ? await git(repoPath, ["rev-parse", "--verify", `${request.headSha}^{commit}`])
      : await git(repoPath, ["rev-parse", "HEAD"]);
  } catch {
    return blocked(taskId, request, "Base or head commit could not be resolved; validation requires real Git identifiers.");
  }
  if (!baseSha) return blocked(taskId, { ...request, branch, headSha }, "Base commit SHA is required for progress comparison.");
  if (request.branch && request.branch !== branch) {
    return blocked(taskId, { ...request, branch, baseSha, headSha }, "The checked-out branch does not match the requested branch.");
  }

  try {
    const diff = await git(repoPath, ["diff", "--binary", `${baseSha}..${headSha}`]);
    const names = await git(repoPath, ["diff", "--name-status", `${baseSha}..${headSha}`]);
    const changedFiles = parseChangedFiles(names);
      const checkNames: GitCheckName[] = request.checks?.length ? request.checks : ["git-diff-check", "secret-scan", "dependency-scan"];
    const checks = await Promise.all(
      checkNames.map((name) => runCheck(repoPath, name, baseSha, headSha))
    );
    const failed = checks.some((check) => check.status !== "passed");
    return {
      status: failed ? "failed" : changedFiles.length ? "verified" : "blocked",
      reason: changedFiles.length ? undefined : "No changed files exist between the recorded base and head commits.",
      taskId,
      repository: { path: displayPath, url: request.repositoryUrl, branch, baseSha, headSha },
      changedFiles,
      diffHash: `sha256:${createHash("sha256").update(diff).digest("hex")}`,
      checks,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return blocked(taskId, { ...request, branch, baseSha, headSha }, "Git diff evidence could not be read from the repository.");
  }
}
