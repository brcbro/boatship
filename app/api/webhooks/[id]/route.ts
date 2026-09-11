import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { WebhookEvent } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const ALL_EVENTS: WebhookEvent[] = [
  "client.created",
  "client.completed",
  "client.invited",
  "task.completed",
  "task.overdue",
  "document.approved",
  "document.rejected",
  "form.submitted",
];

function parseEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value)) return null;
  const out: WebhookEvent[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ALL_EVENTS.includes(item as WebhookEvent)) {
      return null;
    }
    if (!out.includes(item as WebhookEvent)) out.push(item as WebhookEvent);
  }
  return out;
}

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const { id } = await params;
    const store = await getStore();
    const webhook = await store.getWebhook(id);
    if (!webhook) throw jsonError("Webhook not found", 404);
    const deliveries = (await store.listWebhookDeliveries(id)).slice(0, 50);
    return { webhook, deliveries };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getWebhook(id);
    if (!existing) throw jsonError("Webhook not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      active?: boolean;
    };

    const next = { ...existing, updatedAt: new Date().toISOString() };

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw jsonError("name cannot be empty", 400);
      next.name = name;
    }
    if (body.url !== undefined) {
      const url = body.url.trim();
      if (!url) throw jsonError("url cannot be empty", 400);
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid");
        }
      } catch {
        throw jsonError("url must be a valid http(s) URL", 400);
      }
      next.url = url;
    }
    if (body.secret !== undefined) {
      const secret = body.secret.trim();
      if (!secret) throw jsonError("secret cannot be empty", 400);
      next.secret = secret;
    }
    if (body.events !== undefined) {
      const events = parseEvents(body.events);
      if (!events || events.length === 0) {
        throw jsonError(`events must be a non-empty subset of: ${ALL_EVENTS.join(", ")}`, 400);
      }
      next.events = events;
    }
    if (body.active !== undefined) next.active = Boolean(body.active);

    const webhook = await store.upsertWebhook(next);
    return { webhook };
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getWebhook(id);
    if (!existing) throw jsonError("Webhook not found", 404);
    await store.deleteWebhook(id);
    return { ok: true };
  });
}
