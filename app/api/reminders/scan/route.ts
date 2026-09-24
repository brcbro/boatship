import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { dispatchReminderFindings, type ReminderChannel, type ReminderReason } from "@/lib/reminders";
import { requireClientAccess } from "@/lib/client-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = await req.json().catch(() => ({})) as { dryRun?: boolean; staleHours?: number; channels?: ReminderChannel[]; reasons?: ReminderReason[]; clientId?: string; taskId?: string };
    if (session.role === "team" && !body.clientId) throw jsonError("clientId is required for team requests", 400);
    if (body.clientId) await requireClientAccess(session, body.clientId);
    return dispatchReminderFindings({
      actorId: session.uid,
      actorName: session.name,
      dryRun: body.dryRun !== false,
      staleHours: body.staleHours,
      channels: body.channels,
      reasons: body.reasons,
      clientId: body.clientId,
      taskId: body.taskId,
    });
  });
}
