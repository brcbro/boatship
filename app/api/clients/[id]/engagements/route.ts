import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { ensureLegacyEngagement, engagementWithProgress, localClientDemo } from "@/lib/engagements";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import type { EngagementType } from "@/types";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const TYPES: EngagementType[] = ["onboarding", "project", "ongoing_service"];

function dateOrNull(value: unknown, field: string): Date | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw jsonError(`Invalid ${field}`, 400);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw jsonError(`Invalid ${field}`, 400);
  return date;
}

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    const store = await getStore();
    const client = await store.getClient(id);
    if (!client) throw jsonError("Client not found", 404);
    const legacy = await ensureLegacyEngagement(client);
    if (localClientDemo()) {
      const tasks = await store.listTasks(id);
      return { engagements: [engagementWithProgress(legacy, session.role === "client" ? tasks.filter((task) => task.type === "client_facing") : tasks)] };
    }
    const [rows, tasks] = await Promise.all([
      getPrisma().engagement.findMany({ where: { clientId: id }, orderBy: { createdAt: "asc" } }),
      store.listTasks(id),
    ]);
    const visibleTasks = session.role === "client" ? tasks.filter((task) => task.type === "client_facing") : tasks;
    return { engagements: rows.map((row) => engagementWithProgress(row, visibleTasks)) };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    const store = await getStore();
    const client = await store.getClient(id);
    if (!client) throw jsonError("Client not found", 404);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (localClientDemo()) throw jsonError("Creating engagements requires a configured database", 501);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 160) throw jsonError("Invalid name", 400);
    if (!TYPES.includes(body.type as EngagementType)) throw jsonError("Invalid type", 400);
    const ownerId = body.ownerId === undefined ? client.assignedTeamMemberId : body.ownerId;
    if (ownerId !== null && typeof ownerId !== "string") throw jsonError("Invalid ownerId", 400);
    if (typeof ownerId === "string" && !ownerId.trim()) throw jsonError("Invalid ownerId", 400);
    if (session.role === "team" && ownerId !== session.uid) throw jsonError("Forbidden", 403);
    if (ownerId) {
      const owner = await store.getUser(ownerId);
      if (!owner || (owner.role !== "admin" && owner.role !== "team")) throw jsonError("Invalid ownerId", 400);
    }
    const startDate = dateOrNull(body.startDate, "startDate");
    const targetDate = dateOrNull(body.targetDate, "targetDate");
    if (startDate && targetDate && targetDate < startDate) throw jsonError("targetDate precedes startDate", 400);
    await ensureLegacyEngagement(client);
    const row = await getPrisma().engagement.create({ data: {
      id: randomUUID(), clientId: id, name, type: body.type as EngagementType,
      status: "planned", ownerId, startDate, targetDate,
    } });
    return { engagement: engagementWithProgress(row, []) };
  });
}
