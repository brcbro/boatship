import { getStore } from "@/lib/store";
import { jsonError } from "@/lib/api";
import { ENGAGEMENTS, legacyEngagementId, localClientDemo } from "@/lib/engagements";
export { resourceEngagementId, resourceInEngagement } from "@/lib/resource-engagement-scope";

export async function validateResourceEngagement(clientId: string, requested: unknown, taskId?: unknown, allowClosed = false): Promise<string | null> {
  if (requested !== undefined && requested !== null && (typeof requested !== "string" || !requested.trim())) throw jsonError("Choose a valid engagement or account-wide context.", 400);
  if (taskId !== undefined && taskId !== null && (typeof taskId !== "string" || !taskId.trim())) throw jsonError("Choose a valid related task.", 400);
  const task = typeof taskId === "string" ? await (await getStore()).getTask(taskId) : null;
  if (typeof taskId === "string" && (!task || task.clientId !== clientId)) throw jsonError("The related task must belong to this client.", 400);
  const inherited = task ? task.engagementId || legacyEngagementId(clientId) : null;
  const id = typeof requested === "string" ? requested.trim() : inherited;
  if (inherited && id && inherited !== id) throw jsonError("The engagement must match the related task.", 400);
  if (!id) return null;
  if (localClientDemo()) {
    if (id !== legacyEngagementId(clientId)) throw jsonError("This engagement requires a configured database.", 501);
    return id;
  }
  const engagement = await ENGAGEMENTS.get(id);
  if (!engagement || engagement.clientId !== clientId) throw jsonError("The engagement must belong to this client.", 400);
  if (!allowClosed && (engagement.status === "completed" || engagement.status === "cancelled")) throw jsonError("This engagement is closed. Choose an active engagement.", 409);
  return id;
}
