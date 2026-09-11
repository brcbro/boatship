import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { notifyStaffForClient, notifyUser } from "@/lib/notifications";
import { canAccessClient, isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function normalizeMentionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const task = await store.getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);

    if (session.role === "client" && task.type !== "client_facing") {
      throw jsonError("Forbidden", 403);
    }

    const comments = await store.listTaskComments(id);
    return { comments };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const task = await store.getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);

    if (session.role === "client" && task.type !== "client_facing") {
      throw jsonError("Forbidden", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      body?: string;
      mentionUserIds?: string[];
    };
    const text = body.body?.trim();
    if (!text) throw jsonError("body is required", 400);

    const mentionUserIds = [...new Set(normalizeMentionIds(body.mentionUserIds))];

    const comment = await store.addTaskComment({
      taskId: task.id,
      clientId: task.clientId,
      authorId: session.uid,
      authorName: session.name,
      body: text,
      mentionUserIds,
    });

    await store.addActivity({
      clientId: task.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "task.comment",
      meta: { taskId: task.id, commentId: comment.id, mentionUserIds },
    });

    const client = await store.getClient(task.clientId);
    const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    const title = `Comment on “${task.title}”`;
    const staffHref = `/clients/${task.clientId}`;
    const clientHref = "/portal/tasks";

    if (isStaff(session.role)) {
      const users = await store.listUsers();
      const clientUsers = users.filter(
        (u) => u.role === "client" && u.clientId === task.clientId && u.uid !== session.uid
      );
      await Promise.all(
        clientUsers.map((u) =>
          notifyUser({
            userId: u.uid,
            kind: "task_comment",
            title,
            body: `${session.name}: ${preview}`,
            href: clientHref,
            clientId: task.clientId,
          })
        )
      );
      if (
        task.assignedTo &&
        task.assignedTo !== session.uid &&
        !clientUsers.some((u) => u.uid === task.assignedTo)
      ) {
        await notifyUser({
          userId: task.assignedTo,
          kind: "task_comment",
          title,
          body: `${session.name}: ${preview}`,
          href: staffHref,
          clientId: task.clientId,
        });
      }
    } else {
      await notifyStaffForClient({
        clientId: task.clientId,
        assignedTeamMemberId: client?.assignedTeamMemberId ?? null,
        kind: "task_comment",
        title,
        body: `${session.name}: ${preview}`,
        href: staffHref,
        excludeUserId: session.uid,
      });
    }

    const allUsers = await store.listUsers();
    const userById = new Map(allUsers.map((u) => [u.uid, u]));
    await Promise.all(
      mentionUserIds
        .filter((uid) => uid !== session.uid)
        .map((uid) => {
          const mentioned = userById.get(uid);
          const href =
            mentioned?.role === "client" ? clientHref : staffHref;
          return notifyUser({
            userId: uid,
            kind: "mention",
            title: `${session.name} mentioned you`,
            body: `On “${task.title}”: ${preview}`,
            href,
            clientId: task.clientId,
          });
        })
    );

    return { comment };
  });
}
