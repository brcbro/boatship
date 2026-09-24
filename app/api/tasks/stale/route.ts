import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { dispatchReminderFindings, scanReminderFindings, type ReminderReason } from "@/lib/reminders";
import { filterAssignedClients, requireClientAccess } from "@/lib/client-access";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const url = new URL(req.url);
    const staleHours = Number(url.searchParams.get("staleHours") || 72);
    const clientId = url.searchParams.get("clientId") || undefined;
    if (clientId) await requireClientAccess(session, clientId);
    const visibleIds = new Set((await filterAssignedClients(session, await (await getStore()).listClients())).map((client) => client.id));
    const findings = (await scanReminderFindings({ staleHours, clientId, reasons: ["stale", "suspicious_completion"] }))
      .filter((finding) => visibleIds.has(finding.clientId));
    return { findings, count: findings.length, staleHours, mode: "review_only" };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = await req.json().catch(() => ({})) as { dryRun?: boolean; staleHours?: number; channels?: string[]; reasons?: ReminderReason[]; clientId?: string; taskId?: string };
    if (session.role === "team" && !body.clientId) throw jsonError("clientId is required for team requests", 400);
    if (body.clientId) await requireClientAccess(session, body.clientId);
    const channels = body.channels?.filter((channel): channel is "email" | "telegram" | "slack" => ["email", "telegram", "slack"].includes(channel as string));
    return dispatchReminderFindings({ actorId: session.uid, actorName: session.name, dryRun: body.dryRun !== false, staleHours: body.staleHours, channels, reasons: body.reasons || ["stale", "suspicious_completion"], clientId: body.clientId, taskId: body.taskId });
  });
}
