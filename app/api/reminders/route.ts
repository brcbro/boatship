import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import {
  documentExpiringEmailHtml,
  nudgeEmailHtml,
  overdueTaskEmailHtml,
  sendEmail,
} from "@/lib/email";
import { notifyStaffForClient, notifyUser } from "@/lib/notifications";
import { getStore } from "@/lib/store";
import type { Client } from "@/types";

export const runtime = "nodejs";

function sameUtcDay(a: string, b: Date) {
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

async function findClientUser(store: Awaited<ReturnType<typeof getStore>>, clientId: string) {
  const users = await store.listUsers();
  return users.find((u) => u.role === "client" && u.clientId === clientId) || null;
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      type?: "overdue" | "nudge" | "expiry" | "escalate";
      clientId?: string;
    };

    if (!body.type || !["overdue", "nudge", "expiry", "escalate"].includes(body.type)) {
      throw jsonError('type must be "overdue", "nudge", "expiry", or "escalate"', 400);
    }

    const store = await getStore();
    const base = appBaseUrl(req);
    const now = new Date();

    if (body.type === "escalate") {
      const clients = body.clientId
        ? ([await store.getClient(body.clientId)].filter(Boolean) as Client[])
        : await store.listClients();
      if (body.clientId && clients.length === 0) throw jsonError("Client not found", 404);

      const escalated: Array<{ taskId: string; clientId: string }> = [];
      const skipped: Array<{ taskId: string; reason: string }> = [];

      for (const client of clients) {
        const tasks = await store.listTasks(client.id);
        for (const task of tasks) {
          if (task.status === "completed") continue;
          if (!task.dueDate || new Date(task.dueDate).getTime() >= now.getTime()) {
            skipped.push({ taskId: task.id, reason: "not_overdue" });
            continue;
          }
          if (task.escalatedAt) {
            skipped.push({ taskId: task.id, reason: "already_escalated" });
            continue;
          }

          await store.updateTask(task.id, { escalatedAt: now.toISOString(), priority: task.priority === "urgent" ? "urgent" : "high" });

          const admins = (await store.listUsers()).filter((u) => u.role === "admin");
          const targets = new Set<string>(admins.map((a) => a.uid));
          if (task.assignedTo) targets.add(task.assignedTo);
          if (client.assignedTeamMemberId) targets.add(client.assignedTeamMemberId);

          await Promise.all(
            [...targets].map((uid) =>
              notifyUser({
                userId: uid,
                kind: "task_escalated",
                title: `Escalated: ${task.title}`,
                body: `Overdue task for ${client.companyName} needs attention.`,
                href: `/clients/${client.id}`,
                clientId: client.id,
              })
            )
          );

          await store.addActivity({
            clientId: client.id,
            actorId: session.uid,
            actorName: session.name,
            action: "task.escalated",
            meta: { taskId: task.id },
          });

          escalated.push({ taskId: task.id, clientId: client.id });
        }
      }

      return { type: "escalate", escalated, skipped, count: escalated.length };
    }

    if (body.type === "expiry") {
      const windowMs = 30 * 24 * 60 * 60 * 1000;
      const horizon = now.getTime() + windowMs;
      const docs = body.clientId
        ? await store.listDocuments(body.clientId)
        : await store.listAllDocuments();

      if (body.clientId) {
        const client = await store.getClient(body.clientId);
        if (!client) throw jsonError("Client not found", 404);
      }

      const sent: Array<{ documentId: string; clientId: string; expiresAt: string }> = [];
      const skipped: Array<{ documentId: string; reason: string }> = [];

      for (const doc of docs) {
        if (!doc.expiresAt) {
          skipped.push({ documentId: doc.id, reason: "no_expiry" });
          continue;
        }
        const expiresMs = new Date(doc.expiresAt).getTime();
        if (Number.isNaN(expiresMs) || expiresMs > horizon) {
          skipped.push({ documentId: doc.id, reason: "outside_window" });
          continue;
        }
        if (doc.expiryAlertSentAt) {
          skipped.push({ documentId: doc.id, reason: "already_alerted" });
          continue;
        }

        const client = await store.getClient(doc.clientId);
        if (!client) {
          skipped.push({ documentId: doc.id, reason: "client_missing" });
          continue;
        }

        const staffUsers = (await store.listUsers()).filter(
          (u) =>
            u.role === "admin" ||
            (u.role === "team" && u.uid === client.assignedTeamMemberId)
        );

        for (const staff of staffUsers) {
          if (staff.email) {
            try {
              await sendEmail({
                to: staff.email,
                subject: `Document expiring: ${doc.fileName}`,
                html: documentExpiringEmailHtml({
                  name: staff.name,
                  fileName: doc.fileName,
                  clientName: client.companyName,
                  expiresAt: doc.expiresAt,
                  link: `${base}/clients/${client.id}`,
                }),
              });
            } catch (err) {
              console.error("Failed to send expiry alert email", err);
            }
          }
        }

        await notifyStaffForClient({
          clientId: client.id,
          assignedTeamMemberId: client.assignedTeamMemberId,
          kind: "document_expiring",
          title: "Document expiring soon",
          body: `"${doc.fileName}" for ${client.companyName} expires ${doc.expiresAt}.`,
          href: `/clients/${client.id}`,
        });

        await store.updateDocument(doc.id, { expiryAlertSentAt: now.toISOString() });
        await store.addActivity({
          clientId: client.id,
          actorId: session.uid,
          actorName: session.name,
          action: "reminder.expiry",
          meta: { documentId: doc.id, expiresAt: doc.expiresAt },
        });

        sent.push({
          documentId: doc.id,
          clientId: client.id,
          expiresAt: doc.expiresAt,
        });
      }

      return { type: "expiry", sent, skipped, count: sent.length };
    }

    if (body.type === "overdue") {
      const clients = body.clientId
        ? ([await store.getClient(body.clientId)].filter(Boolean) as Client[])
        : await store.listClients();

      if (body.clientId && clients.length === 0) {
        throw jsonError("Client not found", 404);
      }

      const sent: Array<{ taskId: string; clientId: string; to: string | null }> = [];
      const skipped: Array<{ taskId: string; reason: string }> = [];

      for (const client of clients) {
        const tasks = await store.listTasks(client.id);
        for (const task of tasks) {
          if (!task.dueDate || task.status === "completed") continue;
          if (new Date(task.dueDate).getTime() >= now.getTime()) continue;

          if (task.reminderSentAt && sameUtcDay(task.reminderSentAt, now)) {
            skipped.push({ taskId: task.id, reason: "already_sent_today" });
            continue;
          }

          let to: string | null = client.primaryContactEmail || null;
          let name = client.name;
          let notifyUserId: string | null = null;

          if (task.assignedRole === "client") {
            const clientUser = await findClientUser(store, client.id);
            if (clientUser) {
              notifyUserId = clientUser.uid;
              if (clientUser.email) {
                to = clientUser.email;
                name = clientUser.name;
              }
            }
          } else if (task.assignedTo) {
            const assignee = await store.getUser(task.assignedTo);
            if (assignee) {
              notifyUserId = assignee.uid;
              if (assignee.email) {
                to = assignee.email;
                name = assignee.name;
              }
            }
          }

          const link =
            task.assignedRole === "client"
              ? `${base}/portal/tasks`
              : `${base}/clients/${client.id}`;

          if (to) {
            try {
              await sendEmail({
                to,
                subject: `Overdue task: ${task.title}`,
                html: overdueTaskEmailHtml({
                  name,
                  taskTitle: task.title,
                  dueDate: task.dueDate,
                  link,
                }),
              });
            } catch (err) {
              console.error("Failed to send overdue reminder email", err);
            }
          }

          if (notifyUserId) {
            await notifyUser({
              userId: notifyUserId,
              kind: "task_overdue",
              title: "Overdue task",
              body: `"${task.title}" was due ${task.dueDate}.`,
              href: task.assignedRole === "client" ? "/portal/tasks" : `/clients/${client.id}`,
              clientId: client.id,
            });
          }

          await store.updateTask(task.id, { reminderSentAt: now.toISOString() });
          await store.addActivity({
            clientId: client.id,
            actorId: session.uid,
            actorName: session.name,
            action: "reminder.overdue",
            meta: { taskId: task.id, to },
          });

          sent.push({ taskId: task.id, clientId: client.id, to });
        }
      }

      return { type: "overdue", sent, skipped, count: sent.length };
    }

    // nudge
    const clients = body.clientId
      ? ([await store.getClient(body.clientId)].filter(Boolean) as Client[])
      : (await store.listClients()).filter((c) => c.status === "in_progress");

    if (body.clientId && clients.length === 0) {
      throw jsonError("Client not found", 404);
    }

    const nudged: Array<{ clientId: string; to: string | null; progress: number }> = [];

    for (const client of clients) {
      const progress = await store.clientProgress(client.id);
      const clientUser = await findClientUser(store, client.id);
      const to = clientUser?.email || client.primaryContactEmail || null;
      const name = clientUser?.name || client.name;
      const link = `${base}/portal`;

      if (clientUser) {
        await notifyUser({
          userId: clientUser.uid,
          kind: "nudge",
          title: "Keep going — onboarding nudge",
          body: `You're at ${progress.progress}% for ${client.companyName}.`,
          href: "/portal",
          clientId: client.id,
        });
      }

      if (to) {
        try {
          await sendEmail({
            to,
            subject: `Onboarding nudge — ${client.companyName}`,
            html: nudgeEmailHtml({
              name,
              companyName: client.companyName,
              progress: progress.progress,
              completedTasks: progress.completedTasks,
              totalTasks: progress.totalTasks,
              link,
            }),
          });
        } catch (err) {
          console.error("Failed to send nudge email", err);
        }
      }

      await store.addActivity({
        clientId: client.id,
        actorId: session.uid,
        actorName: session.name,
        action: "reminder.nudge",
        meta: { to, progress: progress.progress },
      });

      nudged.push({ clientId: client.id, to, progress: progress.progress });
    }

    return { type: "nudge", nudged, count: nudged.length };
  });
}
