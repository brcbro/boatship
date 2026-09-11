import { getStore } from "@/lib/store";
import type { NotificationKind } from "@/types";

export async function notifyUser(input: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  clientId?: string | null;
}) {
  const store = await getStore();
  return store.createNotification({
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    href: input.href ?? null,
    clientId: input.clientId ?? null,
  });
}

export async function notifyStaffForClient(input: {
  clientId: string;
  assignedTeamMemberId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  excludeUserId?: string;
}) {
  const store = await getStore();
  const users = await store.listUsers();
  const targets = users.filter(
    (u) =>
      (u.role === "admin" || u.uid === input.assignedTeamMemberId) &&
      u.uid !== input.excludeUserId
  );
  await Promise.all(
    targets.map((u) =>
      store.createNotification({
        userId: u.uid,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        clientId: input.clientId,
      })
    )
  );
}
