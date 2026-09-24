import { DurableObject } from "cloudflare:workers";
import type { PortalMessage } from "../../types";

type MessageEvent = {
  message: PortalMessage;
  type: "message";
};

type Connection = { clientId: string; uid: string };

/** One hibernatable WebSocket room per client conversation. */
export class MessageRoom extends DurableObject {
  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const clientId = request.headers.get("x-boatship-client-id");
    const uid = request.headers.get("x-boatship-user-id");
    if (!clientId || !uid) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [clientId]);
    server.serializeAttachment({ clientId, uid } satisfies Connection);
    server.send(JSON.stringify({ type: "connected" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Called only after the message has been persisted by the canonical API. */
  async publish(event: MessageEvent) {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets(event.message.clientId)) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Unable to deliver message");
      }
    }
  }

  webSocketMessage(socket: WebSocket) {
    // Messages are written through POST /api/messages so authorization and
    // persistence happen once in the canonical API, not on the socket.
    socket.close(1008, "This WebSocket is read-only");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }
}
