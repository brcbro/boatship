import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { dispatchReminderFindings, scanReminderFindings, type ReminderReason } from "@/lib/reminders";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const url = new URL(req.url);
    const staleHours = Number(url.searchParams.get("staleHours") || 72);
    const findings = await scanReminderFindings({ staleHours, clientId: url.searchParams.get("clientId") || undefined, reasons: ["stale", "suspicious_completion"] });
    return { findings, count: findings.length, staleHours, mode: "review_only" };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = await req.json().catch(() => ({})) as { dryRun?: boolean; staleHours?: number; channels?: string[]; reasons?: ReminderReason[]; clientId?: string; taskId?: string };
    const channels = body.channels?.filter((channel): channel is "email" | "telegram" | "slack" => ["email", "telegram", "slack"].includes(channel as string));
    return dispatchReminderFindings({ actorId: session.uid, actorName: session.name, dryRun: body.dryRun !== false, staleHours: body.staleHours, channels, reasons: body.reasons || ["stale", "suspicious_completion"], clientId: body.clientId, taskId: body.taskId });
  });
}
