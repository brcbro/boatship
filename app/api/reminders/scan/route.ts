import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { dispatchReminderFindings, type ReminderChannel, type ReminderReason } from "@/lib/reminders";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = await req.json().catch(() => ({})) as { dryRun?: boolean; staleHours?: number; channels?: ReminderChannel[]; reasons?: ReminderReason[]; clientId?: string; taskId?: string };
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
