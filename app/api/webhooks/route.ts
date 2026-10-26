import { randomBytes, randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { parseWebhookEvents as parseEvents, publicWebhook, validateWebhookUrl, WEBHOOK_EVENTS as ALL_EVENTS } from "@/lib/webhook-security";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const store = await getStore();
    const webhooks = await store.listWebhooks();
    const deliveries = (await store.listWebhookDeliveries()).slice(0, 50);
    return { webhooks: webhooks.map(publicWebhook), deliveries, events: ALL_EVENTS };
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
    const urlError = validateWebhookUrl(url);
    if (urlError) throw jsonError(urlError, 400);

    const events = parseEvents(body.events ?? ALL_EVENTS);
    if (!events || events.length === 0) {
      throw jsonError(`events must be a non-empty subset of: ${ALL_EVENTS.join(", ")}`, 400);
    }

    const now = new Date().toISOString();
    const store = await getStore();
    const generatedSecret = body.secret?.trim() ? null : randomBytes(24).toString("hex");
    const hook = await store.upsertWebhook({
      id: randomUUID(),
      name,
      url,
      secret: body.secret?.trim() || generatedSecret!,
      events,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    });

    return { webhook: publicWebhook(hook), ...(generatedSecret ? { generatedSecret } : {}) };
  });
}
