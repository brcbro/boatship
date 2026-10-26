import { randomBytes, randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { requireStaffPermission } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { parseWebhookEvents, validateWebhookUrl, WEBHOOK_EVENTS, webhookOwnerId } from "@/lib/webhook-security";
import type { AuthSession, WebhookEndpoint } from "@/types";

export const runtime = "nodejs";

/** Subscriptions carry client data, so only staff who can read clients may hold one. */
async function requireSubscriber(req: Request) {
  const session = await requireRoles(req, ["admin", "team"]);
  requireStaffPermission(session, "clients.view");
  return session;
}

/** Hooks may lack a name; admin-managed hooks have no owner and never match. */
function ownedBy(hook: WebhookEndpoint, session: AuthSession) {
  return webhookOwnerId(hook) === session.uid;
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSubscriber(req);
    const store = await getStore();
    const hooks = await store.listWebhooks();
    return { subscriptions: hooks.filter((hook) => ownedBy(hook, session)).map((hook) => ({ id: hook.id, name: hook.name ?? null, url: hook.url, events: hook.events, active: hook.active, createdAt: hook.createdAt, updatedAt: hook.updatedAt })) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSubscriber(req);
    const body = (await req.json().catch(() => ({}))) as { url?: string; events?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) throw jsonError("A valid HTTPS callback URL is required", 400);
    const urlError = validateWebhookUrl(url);
    if (urlError) throw jsonError(urlError, 400);
    const requested = Array.isArray(body.events) && body.events.length ? body.events : ["task.completed"];
    const events = parseWebhookEvents(requested);
    if (!events || events.length === 0) throw jsonError(`events must be a non-empty subset of: ${WEBHOOK_EVENTS.join(", ")}`, 400);
    const store = await getStore();
    const now = new Date().toISOString();
    const hook = await store.upsertWebhook({ id: randomUUID(), name: `MCP:${session.uid}:${randomUUID()}`, ownerId: session.uid, url, secret: randomBytes(24).toString("hex"), events, active: true, createdAt: now, updatedAt: now });
    return { subscription: { id: hook.id, url: hook.url, events: hook.events, active: hook.active }, secret: hook.secret, warning: "Store the signing secret now; it is not shown again." };
  });
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const session = await requireSubscriber(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw jsonError("id is required", 400);
    const store = await getStore();
    const hook = await store.getWebhook(id);
    if (!hook || !ownedBy(hook, session)) throw jsonError("Subscription not found", 404);
    await store.deleteWebhook(id);
    return { ok: true };
  });
}
