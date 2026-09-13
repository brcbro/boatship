import { handleApi, jsonError } from "@/lib/api";
import { requireSession, requireRoles } from "@/lib/auth";
import { generateHodiQueue, listHodiQueue } from "@/lib/hodi-queue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const params = new URL(req.url).searchParams;
    const clientId = params.get("clientId") || undefined;
    if (params.get("refresh") === "1") await generateHodiQueue(session, clientId);
    const status = params.get("status") || undefined;
    if (status && !["open", "in_progress", "snoozed", "dismissed", "completed"].includes(status)) {
      throw jsonError("Invalid queue status", 400);
    }
    const ownerId = params.get("ownerId") || undefined;
    if (session.role === "client" && ownerId) throw jsonError("Clients cannot filter work by owner", 403);
    const includeDismissed = params.get("includeDismissed") === "1";
    return { items: await listHodiQueue(session, { clientId, status, ownerId, includeDismissed }) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : undefined;
    if (body.clientId !== undefined && !clientId) throw jsonError("clientId must be a non-empty string", 400);
    return { items: await generateHodiQueue(session, clientId) };
  });
}
