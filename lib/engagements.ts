import type { Client, Engagement, EngagementStatus, Task } from "@/types";
import { getPrisma } from "@/lib/prisma";
import { legacyEngagementId, taskEngagementId } from "@/lib/engagement-scope";

export { legacyEngagementId, taskEngagementId };
export const localClientDemo = () => !process.env.DATABASE_URL?.trim() && process.env.ALLOW_LOCAL_STORE === "1";

export async function taskEngagementClosed(task: Task): Promise<boolean> {
  if (localClientDemo()) return false;
  const engagement = await getPrisma().engagement.findUnique({ where: { id: taskEngagementId(task) }, select: { status: true } });
  return engagement?.status === "completed" || engagement?.status === "cancelled";
}

function legacyStatus(status: Client["status"]): EngagementStatus {
  if (status === "completed") return "completed";
  if (status === "on_hold") return "paused";
  if (status === "in_progress") return "active";
  return "planned";
}

export async function ensureLegacyEngagement(client: Client) {
  if (localClientDemo()) return {
    id: legacyEngagementId(client.id), clientId: client.id, name: "Onboarding", type: "onboarding",
    status: legacyStatus(client.status), ownerId: client.assignedTeamMemberId,
    startDate: null, targetDate: null,
    completedAt: client.status === "completed" ? new Date(client.updatedAt) : null,
    createdAt: new Date(client.createdAt), updatedAt: new Date(client.updatedAt),
  };
  const prisma = getPrisma();
  const id = legacyEngagementId(client.id);
  const status = legacyStatus(client.status);
  const current = await prisma.engagement.findUnique({ where: { id } });
  const completedAt = status === "completed" ? current?.completedAt || new Date(client.updatedAt) : null;
  if (current) {
    if (current.status === status && current.ownerId === client.assignedTeamMemberId && current.completedAt?.getTime() === completedAt?.getTime()) return current;
    return prisma.engagement.update({ where: { id }, data: { status, ownerId: client.assignedTeamMemberId, completedAt } });
  }
  try {
    return await prisma.engagement.create({ data: {
      id, clientId: client.id, name: "Onboarding", type: "onboarding", status,
      ownerId: client.assignedTeamMemberId, completedAt,
      createdAt: new Date(client.createdAt),
    } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return prisma.engagement.findUniqueOrThrow({ where: { id } });
    }
    throw error;
  }
}

export function engagementWithProgress(
  row: { id: string; clientId: string; name: string; type: string; status: string; ownerId: string | null; startDate: Date | null; targetDate: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date },
  tasks: Task[],
): Engagement {
  const scoped = tasks.filter((task) => taskEngagementId(task) === row.id);
  const completedTaskCount = scoped.filter((task) => task.status === "completed").length;
  return {
    ...row,
    type: row.type as Engagement["type"],
    status: row.status as EngagementStatus,
    startDate: row.startDate?.toISOString() ?? null,
    targetDate: row.targetDate?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taskCount: scoped.length,
    completedTaskCount,
    progress: scoped.length ? Math.round(100 * completedTaskCount / scoped.length) : 0,
  };
}
