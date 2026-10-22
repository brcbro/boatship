import { handleApi, jsonError } from "@/lib/api";
import { nowIso } from "@/lib/firestore";
import { findRepositoryForWebhook, GIT_EVIDENCE, GIT_TASK_LINKS, parseWebhookEvent, verifyWebhookSignature, webhookSecretFromEnvironment, type GitEvidenceDoc, type GitProvider } from "@/lib/git-repositories";
import { createValidationRun } from "@/lib/git-quality";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
type Params = { params: Promise<{ provider: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const { provider: rawProvider } = await params;
    if (rawProvider !== "github" && rawProvider !== "gitlab") throw jsonError("Unsupported Git provider", 400);
    const provider = rawProvider as GitProvider;
    const body = await req.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw jsonError("Webhook body must be valid JSON", 400);
    }
    const event = parseWebhookEvent(provider, payload, req.headers);
    if (!event.owner || !event.repository) return { accepted: true, ignored: "repository metadata missing" };
    const repository = await findRepositoryForWebhook(provider, event.owner, event.repository);
    if (!repository) return { accepted: true, ignored: "repository not connected" };
    const secret = webhookSecretFromEnvironment(provider, event.owner, event.repository);
    if (!secret) throw jsonError("Webhook secret is not configured for this provider/repository", 503);
    const signature = provider === "github"
      ? req.headers.get("x-hub-signature-256")
      : req.headers.get("x-gitlab-signature") || req.headers.get("x-gitlab-token");
    if (!verifyWebhookSignature(provider, secret, signature, body)) throw jsonError("Invalid webhook signature", 401);
    const deliveryExternalId = `delivery:${event.deliveryId}`;
    const existing = (await GIT_EVIDENCE.find([{ field: "externalId", op: "==", value: deliveryExternalId }])).find((row) => row.repositoryId === repository.id);
    if (existing) return { accepted: true, duplicate: true, evidenceId: existing.id, taskId: existing.taskId };
    const created: GitEvidenceDoc = { id: randomUUID(), repositoryId: repository.id, taskId: null, kind: event.kind, title: `${provider} ${event.eventName} ${event.action}`, externalId: deliveryExternalId, url: event.url || null, payload: { normalized: { provider, eventName: event.eventName, deliveryId: event.deliveryId, kind: event.kind, action: event.action, externalId: event.externalId, branch: event.branch, baseBranch: event.baseBranch, headSha: event.headSha, baseSha: event.baseSha }, raw: event.raw as GitEvidenceDoc["payload"] }, createdAt: nowIso() };
    await GIT_EVIDENCE.create(created.id, created);
    const linked = event.externalId ? (await GIT_TASK_LINKS.find([{ field: "pullRequestId", op: "==", value: event.externalId }])).find((row) => row.repositoryId === repository.id) || null : null;
    if (linked) {
      await GIT_EVIDENCE.update(created.id, { taskId: linked.taskId });
      await GIT_TASK_LINKS.update(linked.id, { branch: event.branch || linked.branch, baseSha: event.baseSha || linked.baseSha, headSha: event.headSha || linked.headSha, updatedAt: nowIso() });
      await createValidationRun({ taskId: linked.taskId, status: "blocked", reason: "Webhook received. A local checkout or provider CI evidence is required to verify the PR.", evidence: { provider, event: event.kind, action: event.action, pullRequestUrl: event.url, baseSha: event.baseSha, headSha: event.headSha, changedFiles: [], checks: [], capturedAt: new Date().toISOString() }, source: "webhook" });
    }
    return { accepted: true, evidenceId: created.id, taskId: linked?.taskId || null };
  });
}
