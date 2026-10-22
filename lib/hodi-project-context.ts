import { z } from "zod";

const engagementId = z.string().trim().min(1).nullable().optional();

export const projectMilestoneSchema = z.object({
  clientId: z.string().trim().min(1),
  engagementId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  dueDate: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  taskIds: z.array(z.string().trim().min(1)).optional(),
});

export const projectApprovalSchema = z.object({
  clientId: z.string().trim().min(1),
  engagementId,
  subject: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  kind: z.enum(["document", "design", "release"]).optional(),
});

export class ProjectContextError extends Error {}

type ResolveContext = (clientId: string, requested: unknown, taskId?: unknown) => Promise<string | null>;

/** Use the same live authorization boundary for every linked task, on every call. */
export async function resolveHodiProjectContext(
  clientId: string,
  requested: string | null | undefined,
  taskIds: string[],
  resolve: ResolveContext
) {
  if (new Set(taskIds).size !== taskIds.length) throw new ProjectContextError("Duplicate task");
  const selected = await resolve(clientId, requested, taskIds[0]);
  for (const taskId of taskIds.slice(1)) {
    const linked = await resolve(clientId, selected, taskId);
    if (linked !== selected) throw new ProjectContextError("Milestone tasks must share one engagement.");
  }
  return selected;
}
