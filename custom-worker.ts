// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore OpenNext creates this module after the standalone typecheck step.
import { default as nextWorker } from "./.open-next/worker.js";
import { DurableObject } from "cloudflare:workers";
import { MessageRoom } from "./lib/realtime/message-room";
import { verifyMessageRealtimeTicket } from "./lib/realtime/message-ticket";

type RealtimeEnv = {
  MESSAGE_REALTIME_SECRET?: string;
  BOATSHIP_CRON_SECRET?: string;
  MESSAGE_ROOM: DurableObjectNamespace<MessageRoom>;
  APP_RUNTIME: DurableObjectNamespace<AppRuntime>;
};

function upgradeRequired() {
  return new Response("WebSocket upgrade required", { status: 426, headers: { Upgrade: "websocket" } });
}

export { MessageRoom };
export class AppRuntime extends DurableObject<RealtimeEnv> {
  fetch(request: Request) {
    return nextWorker.fetch(request, this.env, this.ctx);
  }
}

function appRuntime(env: RealtimeEnv) {
  // ponytail: one runtime preserves the existing process-local snapshot cache; shard only after making that cache request-scoped.
  return env.APP_RUNTIME.getByName("main");
}
// Preserve OpenNext's cache Durable Object exports should they be enabled later.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore OpenNext creates this module after the standalone typecheck step.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  async scheduled(controller: ScheduledController, env: RealtimeEnv) {
    if (!env.BOATSHIP_CRON_SECRET) throw new Error("BOATSHIP_CRON_SECRET is required for scheduled jobs");
    const path = controller.cron === "30 3 * * 1-5" ? "product-reminders" : "webhook-drain";
    const response = await appRuntime(env).fetch(new Request(`https://boatship.cohortix.in/api/internal/${path}`, {
      method: "POST", headers: { "x-boatship-cron-secret": env.BOATSHIP_CRON_SECRET },
    }));
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  },
  async fetch(request: Request, env: RealtimeEnv) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/messages/live") return appRuntime(env).fetch(request);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return upgradeRequired();

    const ticket = url.searchParams.get("ticket");
    const secret = env.MESSAGE_REALTIME_SECRET?.trim();
    if (!ticket || !secret) return new Response("Unauthorized", { status: 401 });

    const claims = await verifyMessageRealtimeTicket(ticket, secret);
    if (!claims) return new Response("Unauthorized", { status: 401 });

    const room = env.MESSAGE_ROOM.getByName(`client:${claims.clientId}`);
    return room.fetch("https://message-room.internal/connect", {
      headers: {
        Upgrade: "websocket",
        "x-boatship-client-id": claims.clientId,
        "x-boatship-user-id": claims.uid,
      },
    });
  },
} satisfies ExportedHandler<RealtimeEnv>;
