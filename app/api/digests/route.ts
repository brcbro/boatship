import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { digestEmailHtml, sendEmail } from "@/lib/email";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const base = appBaseUrl(req);
    const now = new Date();
    const nowIso = now.toISOString();

    const users = (await store.listUsers()).filter(
      (u) =>
        (u.role === "admin" || u.role === "team") &&
        u.digestEnabled !== false &&
        Boolean(u.email)
    );

    const [clients, tasks, documents] = await Promise.all([
      store.listClients(),
      store.listAllTasks(),
      store.listAllDocuments(),
    ]);
    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const overdueTasks = tasks.filter((t) => {
      if (!t.dueDate || t.status === "completed") return false;
      return new Date(t.dueDate).getTime() < now.getTime();
    });
    const pendingDocs = documents.filter((d) => d.status === "pending_review");

    const sent: Array<{ userId: string; to: string; overdue: number; pending: number }> = [];
    const skipped: Array<{ userId: string; reason: string }> = [];

    for (const user of users) {
      const overdueLines = overdueTasks
        .filter((t) => {
          if (user.role === "admin") return true;
          const client = clientMap.get(t.clientId);
          return (
            t.assignedTo === user.uid ||
            client?.assignedTeamMemberId === user.uid
          );
        })
        .slice(0, 20)
        .map((t) => {
          const client = clientMap.get(t.clientId);
          return {
            title: t.title,
            dueDate: t.dueDate!,
            clientName: client?.companyName || client?.name || t.clientId,
          };
        });

      const pendingLines = pendingDocs
        .filter((d) => {
          if (user.role === "admin") return true;
          const client = clientMap.get(d.clientId);
          return client?.assignedTeamMemberId === user.uid;
        })
        .slice(0, 20)
        .map((d) => {
          const client = clientMap.get(d.clientId);
          return {
            fileName: d.fileName,
            clientName: client?.companyName || client?.name || d.clientId,
          };
        });

      if (overdueLines.length === 0 && pendingLines.length === 0) {
        skipped.push({ userId: user.uid, reason: "nothing_to_report" });
        continue;
      }

      try {
        await sendEmail({
          to: user.email,
          subject: `Boatship digest — ${overdueLines.length} overdue, ${pendingLines.length} pending docs`,
          html: digestEmailHtml({
            name: user.name,
            overdueTasks: overdueLines,
            pendingDocuments: pendingLines,
            link: `${base}/dashboard`,
          }),
        });
      } catch (err) {
        console.error("Failed to send digest email", err);
        skipped.push({ userId: user.uid, reason: "email_failed" });
        continue;
      }

      await store.upsertUser({
        ...user,
        lastDigestAt: nowIso,
      });

      sent.push({
        userId: user.uid,
        to: user.email,
        overdue: overdueLines.length,
        pending: pendingLines.length,
      });
    }

    return { sent, skipped, count: sent.length };
  });
}
