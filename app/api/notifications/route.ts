import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { filterAssignedClients } from "@/lib/client-access";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const store = await getStore();
    const assignedIds = new Set((await filterAssignedClients(session, await store.listClients())).map((client) => client.id));
    const notifications = (await store.listNotifications(session.uid)).filter((notification) =>
      !notification.clientId || assignedIds.has(notification.clientId)
    );
    const unreadCount = notifications.filter((n) => !n.readAt).length;
    return { notifications, unreadCount };
  });
}

export async function PATCH(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      all?: boolean;
      id?: string;
    };

    const store = await getStore();

    if (body.all === true) {
      const updated = await store.markAllNotificationsRead(session.uid);
      return { updated };
    }

    if (!body.id?.trim()) {
      throw jsonError("Provide { all: true } or { id }", 400);
    }

    if (session.role === "team") {
      const assignedIds = new Set((await filterAssignedClients(session, await store.listClients())).map((client) => client.id));
      const notification = (await store.listNotifications(session.uid)).find((item) => item.id === body.id?.trim());
      if (!notification || (notification.clientId && !assignedIds.has(notification.clientId))) {
        throw jsonError("Notification not found", 404);
      }
    }

    try {
      const notification = await store.markNotificationRead(body.id.trim(), session.uid);
      return { notification };
    } catch {
      throw jsonError("Notification not found", 404);
    }
  });
}
