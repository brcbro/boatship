import { getStore, type DataStore } from "@/lib/store";
import type { WebhookEndpoint, WebhookEvent } from "@/types";
import { signWebhookBody, validateWebhookUrl, webhookOwnerId, webhookOwnerScope } from "@/lib/webhook-security";
import { canAccessClient } from "@/lib/client-access";
import { drainAfterResponse } from "@/lib/queue-drain";

/** Whether this hook may receive this payload; see `webhookOwnerScope`. */
async function hookMayReceive(store: DataStore, hook: WebhookEndpoint, payload: Record<string, unknown>) {
  const ownerId = webhookOwnerId(hook);
  if (!ownerId) return true;
  const scope = webhookOwnerScope(await store.getUser(ownerId), payload);
  return scope ? canAccessClient(scope.session, scope.clientId) : false;
}

/** Persist delivery intent before the request returns; a background drain sends it and the hourly cron retries. */
export async function dispatchWebhooks(event: WebhookEvent, payload: Record<string, unknown>) {
  const store = await getStore();
  const subscribed = (await store.listWebhooks()).filter((hook) => hook.active && hook.events.includes(event));
  const allowed = await Promise.all(subscribed.map((hook) => hookMayReceive(store, hook, payload)));
  const hooks = subscribed.filter((_, index) => allowed[index]);
  await store.addWebhookDeliveries(hooks.map((hook) => ({
    webhookId: hook.id, event, payload, statusCode: null, success: false, error: null,
    state: "pending", attempts: 0, nextAttemptAt: new Date().toISOString(),
    leaseUntil: null, leaseToken: null,
  })));
  if (!hooks.length) return;
  if (process.env.NODE_ENV !== "production") await drainWebhooks();
  else drainAfterResponse("webhook", () => drainWebhooks());
}

export async function drainWebhooks(limit = 20) {
  const store = await getStore();
  const deliveries = await store.claimWebhookDeliveries(limit);
  const hooks = new Map((await store.listWebhooks()).map((hook) => [hook.id, hook]));
  const results = await Promise.all(deliveries.map(async (delivery) => {
    const hook = hooks.get(delivery.webhookId);
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      if (!hook?.active) throw new Error("Webhook is missing or inactive");
      // Re-checked at send time: form submissions queue deliveries without
      // dispatchWebhooks, and the owner's access can change while queued.
      if (!(await hookMayReceive(store, hook, delivery.payload))) throw new Error("Webhook owner cannot access this event's client");
      const urlError = validateWebhookUrl(hook.url);
      if (urlError) throw new Error(`Webhook destination rejected: ${urlError}`);
      const body = JSON.stringify({ event: delivery.event, sentAt: new Date().toISOString(), data: delivery.payload });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boatship-Event": delivery.event,
          "X-Boatship-Delivery": delivery.id,
          "X-Boatship-Timestamp": timestamp,
          "X-Boatship-Signature": signWebhookBody(hook.secret, timestamp, body),
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      statusCode = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Delivery failed";
    }
    return { id: delivery.id, leaseToken: delivery.leaseToken!, statusCode, error };
  }));
  await store.finishWebhookDeliveries(results);
  return { processed: deliveries.length };
}
