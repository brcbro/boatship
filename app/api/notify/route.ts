import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import {
  inviteEmailHtml,
  onboardingCompleteEmailHtml,
  overdueTaskEmailHtml,
  sendEmail,
  taskAssignedEmailHtml,
} from "@/lib/email";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      clientId?: string;
      taskId?: string;
      email?: string;
      name?: string;
      to?: string;
      subject?: string;
      html?: string;
    };

    if (!body.type) throw jsonError("type is required", 400);

    const store = await getStore();
    const base = appBaseUrl(req);

    if (body.type === "overdue_scan") {
      const clients = await store.listClients();
      const now = Date.now();
      const sent: Array<{ taskId: string; to: string }> = [];

      for (const client of clients) {
        const tasks = await store.listTasks(client.id);
        for (const task of tasks) {
          if (
            !task.dueDate ||
            task.status === "completed" ||
            new Date(task.dueDate).getTime() >= now
          ) {
            continue;
          }

          let to = client.primaryContactEmail;
          let name = client.name;
          if (task.assignedRole !== "client" && task.assignedTo) {
            const assignee = await store.getUser(task.assignedTo);
            if (assignee?.email) {
              to = assignee.email;
              name = assignee.name;
            }
          }

          await sendEmail({
            to,
            subject: `Overdue task: ${task.title}`,
            html: overdueTaskEmailHtml({
              name,
              taskTitle: task.title,
              dueDate: task.dueDate,
              link: `${base}${task.assignedRole === "client" ? "/portal" : `/clients/${client.id}`}`,
            }),
          });
          sent.push({ taskId: task.id, to });

          await store.addActivity({
            clientId: client.id,
            actorId: session.uid,
            actorName: session.name,
            action: "notify.overdue",
            meta: { taskId: task.id, to },
          });
        }
      }

      return { sent, count: sent.length };
    }

    if (body.type === "invite") {
      if (!body.clientId) throw jsonError("clientId is required", 400);
      const client = await store.getClient(body.clientId);
      if (!client) throw jsonError("Client not found", 404);
      const to = body.to || body.email || client.primaryContactEmail;
      const name = body.name || client.name;
      await sendEmail({
        to,
        subject: `You're invited to Boatship onboarding — ${client.companyName}`,
        html: inviteEmailHtml({
          name,
          companyName: client.companyName,
          loginUrl: `${base}/login`,
          tempPassword: "Welcome123!",
        }),
      });
      await store.addActivity({
        clientId: client.id,
        actorId: session.uid,
        actorName: session.name,
        action: "notify.invite",
        meta: { to },
      });
      return { ok: true };
    }

    if (body.type === "task_assigned") {
      if (!body.clientId || !body.taskId) {
        throw jsonError("clientId and taskId are required", 400);
      }
      const client = await store.getClient(body.clientId);
      const task = await store.getTask(body.taskId);
      if (!client || !task) throw jsonError("Client or task not found", 404);
      const to = body.to || client.primaryContactEmail;
      await sendEmail({
        to,
        subject: `New onboarding task: ${task.title}`,
        html: taskAssignedEmailHtml({
          name: body.name || client.name,
          taskTitle: task.title,
          link: `${base}/portal`,
        }),
      });
      await store.addActivity({
        clientId: client.id,
        actorId: session.uid,
        actorName: session.name,
        action: "notify.task_assigned",
        meta: { taskId: task.id, to },
      });
      return { ok: true };
    }

    if (body.type === "onboarding_complete") {
      if (!body.clientId) throw jsonError("clientId is required", 400);
      const client = await store.getClient(body.clientId);
      if (!client) throw jsonError("Client not found", 404);
      const to = body.to || client.primaryContactEmail;
      await sendEmail({
        to,
        subject: "Onboarding complete — Boatship",
        html: onboardingCompleteEmailHtml({
          name: body.name || client.name,
          companyName: client.companyName,
        }),
      });
      await store.addActivity({
        clientId: client.id,
        actorId: session.uid,
        actorName: session.name,
        action: "notify.onboarding_complete",
        meta: { to },
      });
      return { ok: true };
    }

    if (body.type === "custom") {
      if (!body.to || !body.subject || !body.html) {
        throw jsonError("to, subject, and html are required for custom emails", 400);
      }
      await sendEmail({ to: body.to, subject: body.subject, html: body.html });
      if (body.clientId) {
        await store.addActivity({
          clientId: body.clientId,
          actorId: session.uid,
          actorName: session.name,
          action: "notify.custom",
          meta: { to: body.to, subject: body.subject },
        });
      }
      return { ok: true };
    }

    throw jsonError(
      "Unknown notify type. Use: overdue_scan, invite, task_assigned, onboarding_complete, custom",
      400
    );
  });
}
