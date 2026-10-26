import type { ActivityLog, DocumentRecord, Task, UserRole } from "@/types";

/**
 * What a client session may see. Every route or tool that hands a task,
 * document or activity entry to a client session goes through these helpers;
 * staff responses are unchanged.
 */

/** Task fields that only staff see: internal notes, watchers, reminder and escalation stamps, automation metadata. */
export const STAFF_ONLY_TASK_FIELDS = ["internalNotes", "watcherIds", "escalatedAt", "reminderSentAt", "metadata"] as const;
export type ClientTask = Omit<Task, (typeof STAFF_ONLY_TASK_FIELDS)[number]>;

export function clientSafeTask<T extends Partial<Task>>(task: T): Omit<T, (typeof STAFF_ONLY_TASK_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...task };
  for (const field of STAFF_ONLY_TASK_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof STAFF_ONLY_TASK_FIELDS)[number]>;
}

/** Applies the client projection only for a client session. */
export function taskForRole<T extends Partial<Task>>(role: UserRole, task: T): T | Omit<T, (typeof STAFF_ONLY_TASK_FIELDS)[number]> {
  return role === "client" ? clientSafeTask(task) : task;
}

/** Clients see client-facing tasks only. */
export function clientCanSeeTask(task: Pick<Task, "type"> | null | undefined): boolean {
  return task?.type === "client_facing";
}

/**
 * A document linked to a task is visible to a client only when that task is
 * client-facing; an account-wide document (no task) is visible. A link to a
 * task that no longer exists is hidden, matching the upload rule.
 */
export function clientCanSeeDocument(
  document: Pick<DocumentRecord, "taskId">,
  tasksById: Map<string, Pick<Task, "type">>,
): boolean {
  if (!document.taskId) return true;
  return clientCanSeeTask(tasksById.get(document.taskId));
}

/**
 * Activity actions a client may see, with the only meta keys passed through.
 * Everything else (staff edits, patches, Git evidence, Hodi, MCP, reminders,
 * credential and account events, client record changes) stays staff-only.
 * Entries that refer to a task or document are further limited to records
 * the client can see.
 */
export const CLIENT_VISIBLE_ACTIVITY: Readonly<Record<string, readonly string[]>> = {
  "task.created": ["taskId", "title"],
  "task.updated": ["taskId", "status"],
  "task.comment": ["taskId", "commentId"],
  "document.reviewed": ["documentId", "status"],
  "form.submitted": ["formId", "formTemplateId"],
  "form.reviewed": ["formId"],
  "vessel.created": ["vesselId", "name"],
  "vessel.updated": ["vesselId", "name"],
  "vessel.deleted": ["vesselId", "name"],
};

export function clientSafeActivity(
  entries: ActivityLog[],
  tasksById: Map<string, Pick<Task, "type">>,
  documentsById: Map<string, Pick<DocumentRecord, "taskId">>,
): ActivityLog[] {
  const out: ActivityLog[] = [];
  for (const entry of entries) {
    const allowedKeys = CLIENT_VISIBLE_ACTIVITY[entry.action];
    if (!allowedKeys) continue;
    const meta = entry.meta || {};
    const taskId = typeof meta.taskId === "string" ? meta.taskId : null;
    if (taskId !== null && !clientCanSeeTask(tasksById.get(taskId))) continue;
    if (entry.action.startsWith("task.") && taskId === null) continue;
    const documentId = typeof meta.documentId === "string" ? meta.documentId : null;
    if (documentId !== null) {
      const document = documentsById.get(documentId);
      if (!document || !clientCanSeeDocument(document, tasksById)) continue;
    }
    const projected: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (key === "status" && entry.action === "task.updated") {
        const patch = meta.patch as Record<string, unknown> | undefined;
        if (patch && typeof patch.status === "string") projected.status = patch.status;
        continue;
      }
      if (meta[key] !== undefined) projected[key] = meta[key];
    }
    out.push({ ...entry, meta: projected });
  }
  return out;
}
