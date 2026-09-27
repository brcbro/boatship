import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import {
  inviteEmailHtml,
  emailDeliveryConfigured,
  onboardingCompleteEmailHtml,
  overdueTaskEmailHtml,
  sendEmail,
  TEAM_WELCOME_SUBJECT,
  teamWelcomeEmailHtml,
  taskAssignedEmailHtml,
  taskAssignedSubject,
} from "@/lib/email";
import { localClientDemo, taskEngagementId } from "@/lib/engagements";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { filterAssignedClients, requireClientAccess } from "@/lib/client-access";
import { consumeRateLimit } from "@/lib/rate-limit";

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
    if (body.clientId) await requireClientAccess(session, body.clientId);

    const store = await getStore();
    const base = appBaseUrl(req);

    if (body.type === "overdue_scan") {
      const clients = await filterAssignedClients(session, await store.listClients());
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
      if (!emailDeliveryConfigured()) throw jsonError("Email delivery is not configured", 503);
      if (!body.clientId) throw jsonError("clientId is required", 400);
      const client = await store.getClient(body.clientId);
      if (!client) throw jsonError("Client not found", 404);
      const to = (body.to || body.email || client.primaryContactEmail).trim().toLowerCase();
      const name = (body.name || client.name).trim();
      if (!to || !name) throw jsonError("Email and name are required", 400);
      const existing = await store.getUserByEmail(to);
      if (existing && (existing.role !== "client" || existing.clientId !== client.id)) {
        throw jsonError("This email already belongs to another account", 400);
      }
      const inviteToken = randomUUID().replace(/-/g, "");
      const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await sendEmail({
        to,
        subject: `You're invited to the Boatship workspace — ${client.companyName}`,
        html: inviteEmailHtml({
          name,
          companyName: client.companyName,
          loginUrl: `${base}/login?reset=${encodeURIComponent(inviteToken)}`,
        }),
      });
      await store.upsertUser({
        uid: existing?.uid || randomUUID(),
        email: to,
        name,
        role: "client",
        clientId: client.id,
        createdAt: existing?.createdAt || new Date().toISOString(),
        inviteToken,
        inviteTokenExpiresAt,
        mustResetPassword: true,
        password: null,
        passwordHash: null,
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
      if (!client || !task || task.clientId !== client.id) throw jsonError("Client or task not found", 404);
      const engagement = localClientDemo()
        ? { type: "onboarding", name: "Onboarding" }
        : await getPrisma().engagement.findUnique({
            where: { id: taskEngagementId(task) },
            select: { type: true, name: true },
          });
      const to = body.to || client.primaryContactEmail;
      await sendEmail({
        to,
        subject: taskAssignedSubject(task.title, engagement),
        html: taskAssignedEmailHtml({
          name: body.name || client.name,
          taskTitle: task.title,
          link: `${base}/portal`,
          engagement,
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

    if (body.type === "team_welcome") {
      if (session.role !== "admin") throw jsonError("Forbidden", 403);
      if (!emailDeliveryConfigured()) throw jsonError("Email delivery is not configured", 503);
      const to = (body.to || "").trim().toLowerCase();
      const name = (body.name || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254 || !name || name.length > 160) {
        throw jsonError("Valid recipient email and name are required", 400);
      }
      if (!(await consumeRateLimit({ scope: "team-welcome:actor", identity: session.uid, max: 20, windowSeconds: 3600 }))) {
        throw jsonError("Too many welcome emails. Try again later.", 429);
      }
      const result = await sendEmail({
        to,
        senderName: "Boatship Team",
        subject: TEAM_WELCOME_SUBJECT,
        html: teamWelcomeEmailHtml({ name, loginUrl: `${base}/login` }),
      });
      return { ok: true, id: result.id };
    }

    if (body.type === "custom") {
      if (session.role !== "admin") throw jsonError("Forbidden", 403);
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
      "Unknown notify type. Use: overdue_scan, invite, task_assigned, onboarding_complete, team_welcome, custom",
      400
    );
  });
}
