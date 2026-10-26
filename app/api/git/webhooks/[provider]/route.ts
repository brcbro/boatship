import { handleApi, jsonError } from "@/lib/api";
import { nowIso } from "@/lib/firestore";
import { findRepositoryForWebhook, GIT_EVIDENCE, GIT_TASK_LINKS, parseWebhookEvent, verifyWebhookSignature, webhookSecretFromEnvironment, type GitEvidenceDoc, type GitProvider } from "@/lib/git-repositories";
import { createValidationRun } from "@/lib/git-quality";
import { isStaleHeadUpdate, webhookBodyExternalId, webhookEventUpdatedAt } from "@/lib/git-webhook-guard";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
type Params = { params: Promise<{ provider: string }> };

type NormalizedEvidence = { externalId?: string; headSha?: string | null; eventUpdatedAt?: string | null };
function normalizedOf(row: GitEvidenceDoc): NormalizedEvidence {
  const normalized = (row.payload as { normalized?: unknown } | null)?.normalized;
  return normalized && typeof normalized === "object" ? normalized as NormalizedEvidence : {};
}

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
    // Authenticate before any lookup, so unsigned callers cannot probe which
    // repositories are connected. A missing secret answers the same way.
    const secret = webhookSecretFromEnvironment(provider, event.owner, event.repository);
    const signature = provider === "github"
      ? req.headers.get("x-hub-signature-256")
      : req.headers.get("x-gitlab-signature") || req.headers.get("x-gitlab-token");
    if (!secret) console.warn(`Git webhook secret is not configured for ${provider}`);
    if (!verifyWebhookSignature(provider, secret, signature, body)) throw jsonError("Invalid webhook signature", 401);
    const repository = await findRepositoryForWebhook(provider, event.owner, event.repository);
    if (!repository) return { accepted: true, ignored: "repository not connected" };
    // Dedupe on the signed bytes; `delivery:` ids remain for rows written before this check.
    const bodyExternalId = webhookBodyExternalId(body);
    const deliveryExternalId = `delivery:${event.deliveryId}`;
    for (const externalId of [bodyExternalId, deliveryExternalId]) {
      const existing = (await GIT_EVIDENCE.find([{ field: "externalId", op: "==", value: externalId }])).find((row) => row.repositoryId === repository.id);
      if (existing) return { accepted: true, duplicate: true, evidenceId: existing.id, taskId: existing.taskId };
    }
    const eventUpdatedAt = webhookEventUpdatedAt(payload);
    const linked = event.externalId ? (await GIT_TASK_LINKS.find([{ field: "pullRequestId", op: "==", value: event.externalId }])).find((row) => row.repositoryId === repository.id) || null : null;
    const prior = linked
      ? (await GIT_EVIDENCE.find([{ field: "taskId", op: "==", value: linked.taskId }]))
        .filter((row) => row.repositoryId === repository.id)
        .map(normalizedOf)
        .filter((row) => row.externalId === event.externalId)
      : [];
    const stale = linked ? isStaleHeadUpdate({ headSha: event.headSha || null, eventUpdatedAt }, linked.headSha, prior) : false;
    const created: GitEvidenceDoc = { id: randomUUID(), repositoryId: repository.id, taskId: linked?.taskId ?? null, kind: event.kind, title: `${provider} ${event.eventName} ${event.action}`, externalId: bodyExternalId, url: event.url || null, payload: { normalized: { provider, eventName: event.eventName, deliveryId: event.deliveryId, kind: event.kind, action: event.action, externalId: event.externalId, branch: event.branch, baseBranch: event.baseBranch, headSha: event.headSha, baseSha: event.baseSha, eventUpdatedAt, stale }, raw: event.raw as GitEvidenceDoc["payload"] }, createdAt: nowIso() };
    await GIT_EVIDENCE.create(created.id, created);
    // Evidence of an older head is kept for the record but does not rewind the link.
    if (linked && stale) return { accepted: true, ignored: "stale head", evidenceId: created.id, taskId: linked.taskId };
    if (linked) {
      await GIT_TASK_LINKS.update(linked.id, { branch: event.branch || linked.branch, baseSha: event.baseSha || linked.baseSha, headSha: event.headSha || linked.headSha, updatedAt: nowIso() });
      await createValidationRun({ taskId: linked.taskId, status: "blocked", reason: "Webhook received. A local checkout or provider CI evidence is required to verify the PR.", evidence: { provider, event: event.kind, action: event.action, pullRequestUrl: event.url, baseSha: event.baseSha, headSha: event.headSha, changedFiles: [], checks: [], capturedAt: new Date().toISOString() }, source: "webhook" });
    }
    return { accepted: true, evidenceId: created.id, taskId: linked?.taskId || null };
  });
}
