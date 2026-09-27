import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { engagementWithProgress, legacyEngagementId, ensureLegacyEngagement, localClientDemo } from "@/lib/engagements";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import type { EngagementStatus } from "@/types";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const STATUSES: EngagementStatus[] = ["planned", "active", "paused", "completed", "cancelled"];

function parseDate(value: unknown, field: string): Date | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw jsonError(`Invalid ${field}`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw jsonError(`Invalid ${field}`, 400);
  return date;
}

async function accessible(id: string, session: Awaited<ReturnType<typeof requireSession>>) {
  if (localClientDemo()) {
    const clientId = id.startsWith("onboarding_") ? id.slice("onboarding_".length) : "";
    if (!clientId) throw jsonError("Engagement not found", 404);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    const client = await (await getStore()).getClient(clientId);
    if (!client) throw jsonError("Engagement not found", 404);
    return ensureLegacyEngagement(client);
  }
  const row = await getPrisma().engagement.findUnique({ where: { id } });
  if (!row) throw jsonError("Engagement not found", 404);
  if (!await canAccessClient(session, row.clientId)) throw jsonError("Forbidden", 403);
  return row;
}

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const row = await accessible((await params).id, session);
    const tasks = await (await getStore()).listTasks(row.clientId);
    return { engagement: engagementWithProgress(row, session.role === "client" ? tasks.filter((task) => task.type === "client_facing") : tasks) };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const row = await accessible((await params).id, session);
    if (localClientDemo()) throw jsonError("Updating engagements requires a configured database", 501);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: { name?: string; status?: EngagementStatus; ownerId?: string | null; startDate?: Date | null; targetDate?: Date | null; completedAt?: Date | null } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 160) throw jsonError("Invalid name", 400);
      patch.name = body.name.trim();
    }
    if (body.status !== undefined) {
      if (row.id === legacyEngagementId(row.clientId)) throw jsonError("Update onboarding status through the client", 400);
      if (!STATUSES.includes(body.status as EngagementStatus)) throw jsonError("Invalid status", 400);
      patch.status = body.status as EngagementStatus;
      patch.completedAt = body.status === "completed" ? row.completedAt || new Date() : null;
    }
    if (body.ownerId !== undefined) {
      if (row.id === legacyEngagementId(row.clientId)) throw jsonError("Update onboarding owner through the client", 400);
      if (body.ownerId !== null && typeof body.ownerId !== "string") throw jsonError("Invalid ownerId", 400);
      if (typeof body.ownerId === "string" && !body.ownerId.trim()) throw jsonError("Invalid ownerId", 400);
      if (session.role === "team" && body.ownerId !== session.uid) throw jsonError("Forbidden", 403);
      if (body.ownerId) {
        const user = await (await getStore()).getUser(body.ownerId);
        if (!user || (user.role !== "admin" && user.role !== "team")) throw jsonError("Invalid ownerId", 400);
      }
      patch.ownerId = body.ownerId as string | null;
    }
    if (body.startDate !== undefined) patch.startDate = parseDate(body.startDate, "startDate");
    if (body.targetDate !== undefined) patch.targetDate = parseDate(body.targetDate, "targetDate");
    const startDate = patch.startDate === undefined ? row.startDate : patch.startDate;
    const targetDate = patch.targetDate === undefined ? row.targetDate : patch.targetDate;
    if (startDate && targetDate && targetDate < startDate) throw jsonError("targetDate precedes startDate", 400);
    if (!Object.keys(patch).length) throw jsonError("No changes provided", 400);
    const updated = await getPrisma().engagement.update({ where: { id: row.id }, data: patch });
    const tasks = await (await getStore()).listTasks(row.clientId);
    return { engagement: engagementWithProgress(updated, tasks) };
  });
}
