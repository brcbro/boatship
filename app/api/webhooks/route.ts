import { randomBytes, randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { WebhookEvent } from "@/types";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const store = await getStore();
    const webhooks = await store.listWebhooks();
    const deliveries = (await store.listWebhookDeliveries()).slice(0, 50);
    return { webhooks, deliveries, events: ALL_EVENTS };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      active?: boolean;
    };

    const name = body.name?.trim();
    const url = body.url?.trim();
    if (!name) throw jsonError("name is required", 400);
    if (!url) throw jsonError("url is required", 400);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("invalid");
      }
    } catch {
      throw jsonError("url must be a valid http(s) URL", 400);
    }

    const events = parseEvents(body.events ?? ALL_EVENTS);
    if (!events || events.length === 0) {
      throw jsonError(`events must be a non-empty subset of: ${ALL_EVENTS.join(", ")}`, 400);
    }

    const now = new Date().toISOString();
    const store = await getStore();
    const hook = await store.upsertWebhook({
      id: randomUUID(),
      name,
      url,
      secret: body.secret?.trim() || randomBytes(24).toString("hex"),
      events,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    });

    return { webhook: hook };
  });
}
