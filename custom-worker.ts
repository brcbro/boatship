import { default as nextWorker } from "./.open-next/worker.js";
import { MessageRoom } from "./lib/realtime/message-room";
import { verifyMessageRealtimeTicket } from "./lib/realtime/message-ticket";

type RealtimeEnv = {
  MESSAGE_REALTIME_SECRET?: string;
  MESSAGE_ROOM: DurableObjectNamespace<MessageRoom>;
};

function upgradeRequired() {
  return new Response("WebSocket upgrade required", { status: 426, headers: { Upgrade: "websocket" } });
}

export { MessageRoom };
// Preserve OpenNext's cache Durable Object exports should they be enabled later.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

export default {
  async fetch(request: Request, env: RealtimeEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/messages/live") return nextWorker.fetch(request, env, ctx);
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
