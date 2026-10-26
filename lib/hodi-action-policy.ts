/**
 * Pure rules for Hodi action payloads: which keys each action accepts, which
 * enum values are valid, and what a failed execution does to its proposal.
 * Kept free of store and Firestore imports so it is unit-testable.
 */
import type { AssignedRole, TaskPriority, TaskStatus, TaskType } from "@/types";

/**
 * Every key an action may carry. A payload with any other key is rejected
 * before a proposal is stored, so nothing can be written that the preview
 * does not describe.
 */
export const HODI_ACTION_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  create_client: ["name", "companyName", "primaryContactEmail", "assignedTeamMemberId", "templateId", "tags", "discoveryBrief"],
  apply_template: ["clientId", "templateId", "assignedTeamMemberId"],
  create_task: [
    "clientId", "title", "description", "dueDate", "type", "assignedTo", "assignedRole", "status", "priority",
    "internalNotes", "section", "formTemplateId", "requiresUpload",
  ],
  update_task: ["taskId", "title", "description", "status", "dueDate", "assignedTo", "priority"],
  assign_task: ["taskId", "assignedTo"],
  block_task: ["taskId", "note"],
  weekly_status_report: ["clientId"],
  create_accounting_entry: [
    "title", "category", "amount", "month", "dueDate", "paidById", "paidByName", "splitMode", "participants",
    "paidPersonIds", "specificPersonId",
  ],
  update_accounting_entry: [
    "id", "title", "category", "amount", "month", "dueDate", "paidById", "paidByName", "splitMode", "participants",
    "paidPersonIds", "specificPersonId",
  ],
  create_form_template: ["name", "description", "fields"],
  assign_form: ["clientId", "formTemplateId", "engagementId", "title", "description", "dueDate"],
  create_service_template: ["name", "description", "industry", "taskList"],
  create_calendar_event: ["title", "start", "end", "timezone", "description", "attendeeEmails", "createMeetingRoom"],
  create_project_milestone: ["clientId", "engagementId", "title", "description", "dueDate", "taskIds"],
  create_project_approval: ["clientId", "engagementId", "subject", "description", "kind"],
  create_product: ["name", "type", "description", "stage", "ownerId", "visibility", "websiteUrl"],
  create_product_milestone: ["productId", "title", "description", "targetDate", "status", "ownerId"],
  create_product_work_item: ["productId", "title", "description", "milestoneId", "status", "priority", "assigneeId", "dueDate", "dependencyIds"],
  create_product_release: [
    "productId", "version", "environment", "status", "releasedAt", "notes", "repositoryId", "commitSha",
    "deploymentUrl", "workItemIds",
  ],
  run_connected_app_tools: ["tools"],
};

/** Rejects payloads that are not plain objects or carry keys the action does not support. */
export function assertHodiPayloadKeys(action: string, payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("payload must be an object");
  const allowed = HODI_ACTION_PAYLOAD_KEYS[action];
  if (!allowed) throw new Error("Unsupported Hodi action");
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unsupported fields for ${action}: ${unknown.join(", ")}`);
}

const TASK_TYPES: readonly TaskType[] = ["internal", "client_facing"];
const ASSIGNED_ROLES: readonly AssignedRole[] = ["admin", "team", "client"];
const TASK_STATUSES: readonly TaskStatus[] = ["pending", "in_progress", "completed", "blocked"];
const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (value === undefined || value === null || value === "") return fallback;
  const result = typeof value === "string" ? value.trim() : "";
  if (!allowed.includes(result as T)) throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  return result as T;
}

export type NewTaskFields = {
  type: TaskType;
  assignedRole: AssignedRole;
  status: TaskStatus;
  priority: TaskPriority;
  requiresUpload: boolean;
  clientVisible: boolean;
};

/**
 * Validates the enum fields of a new task. Client-facing tasks always belong
 * to the client role, and a client-role task is always client-facing, so the
 * visibility shown in the preview matches what the portal will show.
 */
export function newTaskFields(payload: Record<string, unknown>): NewTaskFields {
  const type = enumValue(payload.type, TASK_TYPES, "internal", "type");
  const assignedRole = enumValue(payload.assignedRole, ASSIGNED_ROLES, type === "client_facing" ? "client" : "team", "assignedRole");
  if (type === "client_facing" && assignedRole !== "client") throw new Error("A client-facing task must use the client assignedRole");
  if (type === "internal" && assignedRole === "client") throw new Error("A task for the client must use the client_facing type");
  const status = enumValue(payload.status, TASK_STATUSES, "pending", "status");
  const priority = enumValue(payload.priority, TASK_PRIORITIES, "medium", "priority");
  if (payload.requiresUpload !== undefined && typeof payload.requiresUpload !== "boolean") throw new Error("requiresUpload must be true or false");
  return { type, assignedRole, status, priority, requiresUpload: payload.requiresUpload === true, clientVisible: type === "client_facing" };
}

/**
 * What a failed execution does to its proposal. Before any write the
 * proposal returns to its previous status so the user can retry. After a
 * write may have happened it becomes `failed`, so a retry cannot repeat the
 * writes that already succeeded.
 */
export function failedProposalOutcome(writesStarted: boolean, previousStatus: "pending" | "approved", error: unknown) {
  if (!writesStarted) return { status: previousStatus, reason: null };
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return { status: "failed" as const, reason: `Execution failed after changes may have started: ${message}`.slice(0, 1000) };
}
