import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { getSessionFromRequest } from "@/lib/auth";
import { isApprovalReviewer } from "@/lib/mcp-controls";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    if (!session || !isApprovalReviewer(session)) throw jsonError("Manager or admin access required", 403);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    const approval = await getPrisma().taskManagerApproval.findUnique({ where: { taskId: id } });
    return { approval };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    if (!session || !isApprovalReviewer(session)) throw jsonError("Manager or admin access required", 403);
    const { id } = await params;
    const task = await (await getStore()).getTask(id);
    if (!task) throw jsonError("Task not found", 404);
    if (!await canAccessClient(session, task.clientId)) throw jsonError("Forbidden", 403);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    const note = typeof body.reason === "string" ? body.reason.trim() : typeof body.note === "string" ? body.note.trim() : "";
    if (!status) throw jsonError("status must be approved or rejected", 400);
    if (status === "rejected" && !note) throw jsonError("A reason is required when rejecting", 400);
    const approval = await getPrisma().taskManagerApproval.upsert({ where: { taskId: id }, create: { id: randomUUID(), taskId: id, reviewerId: session.uid, status, note: note || null, reviewedAt: new Date() }, update: { reviewerId: session.uid, status, note: note || null, reviewedAt: new Date() } });
    return { approval };
  });
}
