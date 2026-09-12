import { randomBytes, randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const store = await getStore();
    const hooks = await store.listWebhooks();
    return { subscriptions: hooks.filter((hook) => hook.name.startsWith(`MCP:${session.uid}:`)).map((hook) => ({ id: hook.id, name: hook.name, url: hook.url, events: hook.events, active: hook.active, createdAt: hook.createdAt, updatedAt: hook.updatedAt })) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as { url?: string; events?: string[] };
    const url = body.url?.trim();
    if (!url || !/^https:\/\//i.test(url)) throw jsonError("A valid HTTPS callback URL is required", 400);
    const store = await getStore();
    const hook = await store.upsertWebhook({ id: randomUUID(), name: `MCP:${session.uid}:${randomUUID()}`, url, secret: randomBytes(24).toString("hex"), events: (body.events?.length ? body.events : ["task.completed"]) as never, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return { subscription: { id: hook.id, url: hook.url, events: hook.events, active: hook.active }, secret: hook.secret, warning: "Store the signing secret now; it is not shown again." };
  });
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw jsonError("id is required", 400);
    const store = await getStore();
    const hook = await store.getWebhook(id);
    if (!hook || !hook.name.startsWith(`MCP:${session.uid}:`)) throw jsonError("Subscription not found", 404);
    await store.deleteWebhook(id);
    return { ok: true };
  });
}
