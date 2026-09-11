import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const store = await getStore();
    const notifications = await store.listNotifications(session.uid);
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

    try {
      const notification = await store.markNotificationRead(body.id.trim(), session.uid);
      return { notification };
    } catch {
      throw jsonError("Notification not found", 404);
    }
  });
}
