import { getStore } from "@/lib/store";
import { sha256Hex } from "@/lib/password";
import type { WebhookEvent } from "@/types";
import { validateWebhookUrl } from "@/lib/webhook-security";

/** Persist delivery intent before the request returns; the scheduled drain sends it. */
export async function dispatchWebhooks(event: WebhookEvent, payload: Record<string, unknown>) {
  const store = await getStore();
  const hooks = (await store.listWebhooks()).filter((hook) => hook.active && hook.events.includes(event));
  await store.addWebhookDeliveries(hooks.map((hook) => ({
    webhookId: hook.id, event, payload, statusCode: null, success: false, error: null,
    state: "pending", attempts: 0, nextAttemptAt: new Date().toISOString(),
    leaseUntil: null, leaseToken: null,
  })));
  if (hooks.length && process.env.NODE_ENV !== "production") await drainWebhooks();
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
      const urlError = validateWebhookUrl(hook.url);
      if (urlError) throw new Error(`Webhook destination rejected: ${urlError}`);
      const body = JSON.stringify({ event: delivery.event, sentAt: new Date().toISOString(), data: delivery.payload });
      const response = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boatship-Event": delivery.event,
          "X-Boatship-Delivery": delivery.id,
          "X-Boatship-Signature": sha256Hex(`${hook.secret}.${body}`),
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
