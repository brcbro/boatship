import { handleApi, jsonError } from "@/lib/api";
import { findRepositoryForWebhook, parseWebhookEvent, verifyWebhookSignature, webhookSecretFromEnvironment, type GitProvider } from "@/lib/git-repositories";
import { getPrisma } from "@/lib/prisma";
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
    const existing = await getPrisma().gitEvidence.findFirst({ where: { repositoryId: repository.id, externalId: deliveryExternalId }, select: { id: true, taskId: true } });
    if (existing) return { accepted: true, duplicate: true, evidenceId: existing.id, taskId: existing.taskId };
    const created = await getPrisma().gitEvidence.create({ data: { id: randomUUID(), repositoryId: repository.id, taskId: null, kind: event.kind, title: `${provider} ${event.eventName} ${event.action}`, externalId: deliveryExternalId, url: event.url || null, payload: { normalized: { provider, eventName: event.eventName, deliveryId: event.deliveryId, kind: event.kind, action: event.action, externalId: event.externalId, branch: event.branch, baseBranch: event.baseBranch, headSha: event.headSha, baseSha: event.baseSha }, raw: event.raw } as never } });
    const linked = event.externalId ? await getPrisma().gitTaskLink.findFirst({ where: { repositoryId: repository.id, pullRequestId: event.externalId } }) : null;
    if (linked) {
      await getPrisma().gitEvidence.update({ where: { id: created.id }, data: { taskId: linked.taskId } });
      await getPrisma().gitTaskLink.update({ where: { id: linked.id }, data: { branch: event.branch || linked.branch, baseSha: event.baseSha || linked.baseSha, headSha: event.headSha || linked.headSha } });
      await getPrisma().gitValidationRun.create({ data: { id: randomUUID(), taskId: linked.taskId, status: "blocked", reason: "Webhook received. A local checkout or provider CI evidence is required to verify the PR.", evidence: { provider, event: event.kind, action: event.action, pullRequestUrl: event.url, baseSha: event.baseSha, headSha: event.headSha, changedFiles: [], checks: [], capturedAt: new Date().toISOString() } as never, source: "webhook" } });
    }
    return { accepted: true, evidenceId: created.id, taskId: linked?.taskId || null };
  });
}
