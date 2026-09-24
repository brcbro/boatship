import { getStore } from "@/lib/store";
import { sha256Hex } from "@/lib/password";
import type { WebhookEvent } from "@/types";
import { validateWebhookUrl } from "@/lib/webhook-security";

export async function dispatchWebhooks(
  event: WebhookEvent,
  payload: Record<string, unknown>
) {
  const store = await getStore();
  const hooks = (await store.listWebhooks()).filter(
    (h) => h.active && h.events.includes(event)
  );

  await Promise.all(
    hooks.map(async (hook) => {
      const body = JSON.stringify({
        event,
        sentAt: new Date().toISOString(),
        data: payload,
      });
      const signature = sha256Hex(`${hook.secret}.${body}`);
      try {
        const urlError = validateWebhookUrl(hook.url);
        if (urlError) throw new Error(`Webhook destination rejected: ${urlError}`);
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Boatship-Event": event,
            "X-Boatship-Signature": signature,
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        await store.addWebhookDelivery({
          webhookId: hook.id,
          event,
          payload,
          statusCode: res.status,
          success: res.ok,
          error: res.ok ? null : `HTTP ${res.status}`,
        });
      } catch (err) {
        await store.addWebhookDelivery({
          webhookId: hook.id,
          event,
          payload,
          statusCode: null,
          success: false,
          error: err instanceof Error ? err.message : "Delivery failed",
        });
      }
    })
  );
}
