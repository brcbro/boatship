import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { getPrisma } from "@/lib/prisma";
import { providerSyncConfig } from "@/lib/git-provider-sync";

export type GitProvider = "github" | "gitlab";

export type NormalizedGitEvent = {
  provider: GitProvider;
  eventName: string;
  deliveryId: string;
  kind: "push" | "pull_request" | "deployment" | "review" | "check" | "unknown";
  action: string;
  externalId: string;
  url: string;
  branch: string;
  baseBranch: string;
  headSha: string;
  baseSha: string;
  owner: string;
  repository: string;
  raw: Record<string, unknown>;
};

export function parseRepositoryUrl(value: string) {
  const input = value.trim().replace(/\.git$/, "");
  const url = input.startsWith("http") ? new URL(input) : null;
  const path = url ? url.pathname.replace(/^\//, "") : input.replace(/^[^:]+:/, "").replace(/^\//, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("Repository URL must include owner and repository");
  return { owner: parts[0]!, repository: parts[1]!, provider: (url?.hostname.includes("gitlab") ? "gitlab" : "github") as GitProvider };
}

export function hashWebhookSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify provider delivery signatures using the raw webhook secret.
 * GitHub signs the exact request bytes with HMAC-SHA256. GitLab's native
 * X-Gitlab-Token is a constant-time shared-secret check; an optional
 * X-Gitlab-Signature is also accepted for HMAC-proxy setups.
 */
export function verifyWebhookSignature(
  provider: GitProvider,
  secret: string | null,
  signature: string | null,
  body: string,
) {
  if (!secret || !signature) return false;
  if (provider === "gitlab" && !signature.startsWith("sha256=")) return safeEqual(signature, secret);
  const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return safeEqual(provided, expected);
}

export function webhookSecretFromEnvironment(provider: GitProvider, owner: string, repository: string) {
  const key = `${owner}_${repository}`.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return process.env[`BOATSHIP_${provider.toUpperCase()}_WEBHOOK_SECRET_${key}`]
    || process.env[`BOATSHIP_${provider.toUpperCase()}_WEBHOOK_SECRET`]
    || process.env.BOATSHIP_GIT_WEBHOOK_SECRET
    || null;
}

export async function createRepository(input: { provider: GitProvider; name: string; owner: string; repository: string; defaultBranch?: string; webhookSecret?: string; accessTokenRef?: string; createdBy: string }) {
  return getPrisma().gitRepositoryConnection.create({
    data: { id: randomUUID(), provider: input.provider, name: input.name, owner: input.owner, repository: input.repository, defaultBranch: input.defaultBranch || "main", webhookSecretHash: input.webhookSecret ? hashWebhookSecret(input.webhookSecret) : null, accessTokenRef: input.accessTokenRef || null, createdBy: input.createdBy },
    select: { id: true, provider: true, name: true, owner: true, repository: true, defaultBranch: true, active: true, createdBy: true, createdAt: true, updatedAt: true },
  });
}

export async function findRepositoryForWebhook(provider: GitProvider, owner: string, repository: string) {
  return getPrisma().gitRepositoryConnection.findFirst({ where: { provider, owner, repository, active: true } });
}

export function parseWebhookEvent(
  provider: GitProvider,
  payload: Record<string, unknown>,
  headers: Headers = new Headers(),
): NormalizedGitEvent {
  const attrs = (payload.object_attributes as Record<string, unknown> | undefined) || payload;
  const pull = (payload.pull_request || payload.merge_request || {}) as Record<string, unknown>;
  const head = (pull.head || pull.last_commit || {}) as Record<string, unknown>;
  const base = (pull.base || {}) as Record<string, unknown>;
  const repository = (payload.repository || payload.project || {}) as Record<string, unknown>;
  const repoNamespace = (repository.namespace as Record<string, unknown> | undefined);
  const eventName = headers.get(provider === "github" ? "x-github-event" : "x-gitlab-event") || inferEventName(provider, payload);
  const action = String(payload.action || attrs.action || attrs.state || "updated");
  const kind = eventKind(provider, eventName, payload);
  const providerId = headers.get(provider === "github" ? "x-github-delivery" : "x-gitlab-event-uuid");
  const externalId = String(pull.id || pull.number || attrs.id || payload.after || "");
  const headSha = String(head.sha || pull.last_commit_id || payload.after || "");
  return {
    provider,
    eventName,
    deliveryId: providerId || createHash("sha256").update(`${provider}:${eventName}:${externalId}:${headSha}:${JSON.stringify(payload)}`).digest("hex"),
    kind,
    action,
    externalId,
    url: String(pull.html_url || pull.web_url || attrs.url || ""),
    branch: String(head.ref || pull.source_branch || payload.ref || "").replace(/^refs\/heads\//, ""),
    baseBranch: String(base.ref || pull.target_branch || "").replace(/^refs\/heads\//, ""),
    headSha,
    baseSha: String(base.sha || ""),
    owner: String((repository.owner as Record<string, unknown> | undefined)?.login || repoNamespace?.full_path || repoNamespace?.name || repository.namespace || repository.path_with_namespace || "").split("/")[0] || "",
    repository: String(repository.name || repository.path || String(repository.path_with_namespace || "").split("/").pop() || ""),
    raw: payload,
  };
}

function inferEventName(provider: GitProvider, payload: Record<string, unknown>) {
  if (provider === "github") {
    if (payload.pull_request) return "pull_request";
    if (payload.workflow_run) return "workflow_run";
    if (payload.deployment) return "deployment";
    if (payload.review) return "pull_request_review";
    if (payload.commits) return "push";
  } else {
    if (payload.object_attributes && payload.object_kind === "merge_request") return "merge_request";
    if (payload.object_kind === "pipeline") return "pipeline";
    if (payload.object_kind === "deployment") return "deployment";
    if (payload.commits) return "push";
  }
  return "unknown";
}

function eventKind(provider: GitProvider, eventName: string, payload: Record<string, unknown>): NormalizedGitEvent["kind"] {
  if (eventName === "push") return "push";
  if (eventName.includes("pull_request") || eventName === "merge_request") return "pull_request";
  if (eventName.includes("review")) return "review";
  if (eventName.includes("check") || eventName.includes("workflow") || eventName === "pipeline") return "check";
  if (eventName.includes("deploy")) return "deployment";
  return provider === "github" && payload.deployment ? "deployment" : "unknown";
}

export type ProviderSyncPlan = {
  provider: GitProvider;
  repositoryId: string;
  status: "not_configured";
  reason: string;
  requiredConfiguration: string[];
};

export function getProviderSyncPlan(repository: { id: string; provider: string; accessTokenRef: string | null }): ProviderSyncPlan {
  const provider = repository.provider === "gitlab" ? "gitlab" : "github";
  return {
    provider,
    repositoryId: repository.id,
    status: "not_configured",
    reason: "Provider API synchronization is not configured; no credentials were invented or fetched.",
    requiredConfiguration: [
      provider === "github" ? "GitHub App installation or OAuth token reference" : "GitLab OAuth/application token reference",
      "Provider webhook secret in the deployment environment",
    ],
  };
}

export async function syncRepositoryMetadata(repository: { id: string; provider: string; owner: string; repository: string; accessTokenRef: string | null }) {
  const plan = getProviderSyncPlan(repository);
  const provider = plan.provider;
  const config = providerSyncConfig(provider, repository.owner, repository.repository, repository.accessTokenRef, process.env);
  if (!config) return plan;
  const response = await fetch(config.url, {
    headers: provider === "github"
      ? { Authorization: `Bearer ${config.token}`, Accept: "application/vnd.github+json", "User-Agent": "Boatship" }
      : { "PRIVATE-TOKEN": config.token },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Git provider metadata sync failed (${response.status})`);
  const metadata = await response.json() as { default_branch?: unknown; html_url?: unknown; web_url?: unknown };
  const defaultBranch = typeof metadata.default_branch === "string" ? metadata.default_branch.trim() : "";
  if (!defaultBranch || defaultBranch.length > 255) throw new Error("Git provider returned an invalid default branch");
  const updated = await getPrisma().gitRepositoryConnection.update({ where: { id: repository.id }, data: { defaultBranch } });
  const url = provider === "github" ? metadata.html_url : metadata.web_url;
  return { provider, repositoryId: updated.id, status: "synced" as const, defaultBranch: updated.defaultBranch, url: typeof url === "string" ? url : null };
}
