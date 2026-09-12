import { handleApi, jsonError } from "@/lib/api";
import { requireSession, requireRoles } from "@/lib/auth";
import { getHodiQueueItem, updateHodiQueueItem, type HodiQueueStatus } from "@/lib/hodi-queue";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => getHodiQueueItem((await params).id, await requireSession(req)));
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status as HodiQueueStatus : undefined;
    if (status && !["open", "in_progress", "snoozed", "dismissed", "completed"].includes(status)) throw jsonError("Invalid queue status", 400);
    const snoozedUntil = body.snoozedUntil === null ? null : typeof body.snoozedUntil === "string" ? body.snoozedUntil : undefined;
    if (snoozedUntil && Number.isNaN(Date.parse(snoozedUntil))) throw jsonError("snoozedUntil must be a valid date", 400);
    const ownerId = body.ownerId === null ? null : typeof body.ownerId === "string" ? body.ownerId.trim() : undefined;
    if (body.ownerId !== undefined && ownerId === undefined) throw jsonError("ownerId must be a string or null", 400);
    return updateHodiQueueItem((await params).id, session, { status, snoozedUntil, ownerId, dismissed: body.dismissed === true });
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    return updateHodiQueueItem((await params).id, session, { dismissed: true });
  });
}
