import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { generateHodiQueue, listHodiQueue } from "@/lib/hodi-queue";

export const runtime = "nodejs";

/** The Hodi queue holds staff recommendations, so every route is staff-only. Reading never writes. */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const params = new URL(req.url).searchParams;
    if (params.has("refresh")) throw jsonError("Refresh the queue with POST /api/hodi/queue", 400);
    const clientId = params.get("clientId") || undefined;
    const status = params.get("status") || undefined;
    if (status && !["open", "in_progress", "snoozed", "dismissed", "completed"].includes(status)) {
      throw jsonError("Invalid queue status", 400);
    }
    const ownerId = params.get("ownerId") || undefined;
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
