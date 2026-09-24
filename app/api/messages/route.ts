import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { notifyStaffForClient, notifyUser } from "@/lib/notifications";
import { getRedisCacheVersion, redisCacheKey, withRedisCache } from "@/lib/redis-cache";
import { canAccessClient } from "@/lib/client-access";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { MessageRoom } from "@/lib/realtime/message-room";
import type { PortalMessage } from "@/types";

export const runtime = "nodejs";

async function publishMessage(clientId: string, message: PortalMessage) {
  try {
    const { env } = getCloudflareContext();
    const room = (env as CloudflareEnv & { MESSAGE_ROOM?: DurableObjectNamespace<MessageRoom> }).MESSAGE_ROOM;
    if (!room) return;
    await room.getByName(`client:${clientId}`).publish({ type: "message", message });
  } catch {
    // Local Next development has no Worker binding. Persistence is already
    // complete and polling remains a safe fallback if delivery is unavailable.
  }
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const cacheVersion = await getRedisCacheVersion();
    const cacheKey = await redisCacheKey("messages", clientId);
    return withRedisCache(cacheKey, cacheVersion, 30, async () => ({
      messages: await store.listMessages(clientId),
    }));
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      body?: string;
    };

    const clientId = body.clientId?.trim();
    const text = body.body?.trim();
    if (!clientId || !text) throw jsonError("clientId and body are required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const message = await store.addMessage({
      clientId,
      authorId: session.uid,
      authorName: session.name,
      authorRole: session.role,
      body: text,
    });

    // Broadcast only after addMessage has persisted the canonical record.
    await publishMessage(clientId, message);

    const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;

    if (session.role === "client") {
      await notifyStaffForClient({
        clientId,
        assignedTeamMemberId: client.assignedTeamMemberId,
        kind: "message",
        title: `Message from ${client.name}`,
        body: preview,
        href: `/messages?clientId=${encodeURIComponent(clientId)}`,
        excludeUserId: session.uid,
      });
    } else if (isStaff(session.role)) {
      const users = await store.listUsers();
      const clientUsers = users.filter(
        (u) => u.role === "client" && u.clientId === clientId && u.uid !== session.uid
      );
      await Promise.all(
        clientUsers.map((u) =>
          notifyUser({
            userId: u.uid,
            kind: "message",
            title: `Message from ${session.name}`,
            body: preview,
            href: "/portal/messages",
            clientId,
          })
        )
      );
    }

    return { message };
  });
}
