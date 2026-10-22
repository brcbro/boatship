import type { Client, Engagement, EngagementStatus, Task } from "@/types";
import { Collection, getFirestore, isLocalDemoStore, nowIso } from "@/lib/firestore";
import { legacyEngagementId, taskEngagementId } from "@/lib/engagement-scope";

export { legacyEngagementId, taskEngagementId };
export const localClientDemo = () => isLocalDemoStore();

/** Firestore document for an engagement; timestamps are ISO-8601 strings. */
export type EngagementDoc = {
  id: string; clientId: string; name: string; type: string; status: string; ownerId: string | null;
  startDate: string | null; targetDate: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
};
export const ENGAGEMENTS = new Collection<EngagementDoc>("Engagement");

export async function taskEngagementClosed(task: Task): Promise<boolean> {
  if (localClientDemo()) return false;
  const engagement = await ENGAGEMENTS.get(taskEngagementId(task));
  return engagement?.status === "completed" || engagement?.status === "cancelled";
}

function legacyStatus(status: Client["status"]): EngagementStatus {
  if (status === "completed") return "completed";
  if (status === "on_hold") return "paused";
  if (status === "in_progress") return "active";
  return "planned";
}

export async function ensureLegacyEngagement(client: Client): Promise<EngagementDoc> {
  const id = legacyEngagementId(client.id);
  const status = legacyStatus(client.status);
  if (localClientDemo()) return {
    id, clientId: client.id, name: "Onboarding", type: "onboarding",
    status, ownerId: client.assignedTeamMemberId,
    startDate: null, targetDate: null,
    completedAt: client.status === "completed" ? new Date(client.updatedAt).toISOString() : null,
    createdAt: new Date(client.createdAt).toISOString(), updatedAt: new Date(client.updatedAt).toISOString(),
  };
  return getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<EngagementDoc>(ENGAGEMENTS.name, id);
    const completedAt = status === "completed" ? current?.data.completedAt || new Date(client.updatedAt).toISOString() : null;
    if (current) {
      if (current.data.status === status && current.data.ownerId === client.assignedTeamMemberId && current.data.completedAt === completedAt) return { ...current.data, id };
      const patch = { status, ownerId: client.assignedTeamMemberId, completedAt, updatedAt: nowIso() };
      tx.write({ update: { collection: ENGAGEMENTS.name, id, data: patch } });
      return { ...current.data, ...patch, id };
    }
    const created: EngagementDoc = {
      id, clientId: client.id, name: "Onboarding", type: "onboarding", status,
      ownerId: client.assignedTeamMemberId, startDate: null, targetDate: null, completedAt,
      createdAt: new Date(client.createdAt).toISOString(), updatedAt: nowIso(),
    };
    tx.write({ set: { collection: ENGAGEMENTS.name, id, data: created, precondition: { exists: false } } });
    return created;
  });
}

export function engagementWithProgress(row: EngagementDoc, tasks: Task[]): Engagement {
  const scoped = tasks.filter((task) => taskEngagementId(task) === row.id);
  const completedTaskCount = scoped.filter((task) => task.status === "completed").length;
  return {
    ...row,
    type: row.type as Engagement["type"],
    status: row.status as EngagementStatus,
    startDate: row.startDate ?? null,
    targetDate: row.targetDate ?? null,
    completedAt: row.completedAt ?? null,
    taskCount: scoped.length,
    completedTaskCount,
    progress: scoped.length ? Math.round(100 * completedTaskCount / scoped.length) : 0,
  };
}
