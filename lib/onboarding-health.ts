import type { Client, DocumentRecord, FormSubmission, Task } from "@/types";

export type OnboardingHealthState =
  | "on_track"
  | "waiting_on_client"
  | "blocked_internally"
  | "ready_to_launch";

export type OnboardingBlocker = {
  kind: "missing_form" | "missing_upload" | "approval" | "overdue_task" | "blocked_task" | "missing_task_definition";
  taskId?: string;
  label: string;
  owner: "client" | "team";
};

export type ReminderCandidate = {
  clientId: string;
  clientName: string;
  recipient: string | null;
  subject: string;
  message: string;
  blockerKind: OnboardingBlocker["kind"];
  taskId?: string;
};

export type OnboardingHealth = {
  clientId: string;
  state: OnboardingHealthState;
  score: number;
  blockers: OnboardingBlocker[];
  overdueTaskCount: number;
  missingFormCount: number;
  missingUploadCount: number;
  pendingApprovalCount: number;
  reminders: ReminderCandidate[];
};

// These task titles are retained only as a compatibility fallback for old
// records that pre-date task metadata. New records should use metadata.origin
// or metadata.legacy instead of relying on names.
const LEGACY_MARITIME_TASKS = new Set([
  "company information form",
  "upload signed contract",
  "upload government id",
  "msa / contract upload",
  "nda upload",
  "compliance questionnaire",
  "banking & billing form",
  "executive sponsor intro",
]);

export function isCurrentOnboardingTask(task: Task) {
  const metadata = task.metadata;
  if (metadata?.legacy === true || metadata?.origin === "legacy" || metadata?.workflow === "maritime-onboarding") {
    return false;
  }
  if (metadata?.legacy === false || metadata?.origin === "current" || metadata?.origin === "template" || metadata?.origin === "manual") {
    return true;
  }
  return !LEGACY_MARITIME_TASKS.has(task.title.trim().toLowerCase());
}

function isOverdue(dueDate: string | null, now: Date) {
  return Boolean(dueDate && new Date(dueDate).getTime() < now.getTime());
}

export function evaluateOnboardingHealth(
  client: Client,
  tasks: Task[],
  forms: FormSubmission[],
  documents: DocumentRecord[],
  now = new Date()
): OnboardingHealth {
  const blockers: OnboardingBlocker[] = [];
  const currentTasks = tasks.filter(isCurrentOnboardingTask);
  const currentTaskIds = new Set(currentTasks.map((task) => task.id));
  const currentForms = forms.filter((form) => !form.taskId || currentTaskIds.has(form.taskId));
  const currentDocuments = documents.filter((document) => !document.taskId || currentTaskIds.has(document.taskId));
  const incompleteTasks = currentTasks.filter((task) => task.status !== "completed");
  const clientOwned = (task: Task) => task.assignedRole === "client" || task.type === "client_facing";

  for (const task of incompleteTasks) {
    const owner = clientOwned(task) ? "client" : "team";
    if (task.status === "blocked") {
      blockers.push({ kind: "blocked_task", taskId: task.id, label: task.title, owner });
    }
    if (isOverdue(task.dueDate, now)) {
      blockers.push({ kind: "overdue_task", taskId: task.id, label: task.title, owner });
    }
    if (
      task.formTemplateId &&
      !currentForms.some(
        (form) =>
          form.taskId === task.id && (form.status === "submitted" || form.status === "reviewed")
      )
    ) {
      blockers.push({ kind: "missing_form", taskId: task.id, label: task.title, owner });
    }
    if (task.requiresUpload && !currentDocuments.some((document) => document.taskId === task.id)) {
      blockers.push({ kind: "missing_upload", taskId: task.id, label: task.title, owner });
    }
  }

  for (const form of currentForms.filter((form) => form.status === "submitted")) {
    const task = currentTasks.find((item) => item.id === form.taskId);
    blockers.push({
      kind: "approval",
      taskId: form.taskId || undefined,
      label: task ? `Review submitted form: ${task.title}` : "Review submitted form",
      owner: "team",
    });
  }
  for (const document of currentDocuments.filter((item) => item.status === "pending_review")) {
    const task = currentTasks.find((item) => item.id === document.taskId);
    blockers.push({
      kind: "approval",
      taskId: document.taskId || undefined,
      label: task ? `Review upload: ${task.title}` : `Review upload: ${document.fileName}`,
      owner: "team",
    });
  }

  // A project with no current work is not healthy by default. Keep the
  // existing state vocabulary for compatibility, but expose a concrete,
  // actionable blocker so Hodi can ask the team to define the work first.
  if (currentTasks.length === 0) {
    blockers.push({ kind: "missing_task_definition", label: "Define the onboarding work for this client", owner: "team" });
  }

  const missingFormCount = blockers.filter((blocker) => blocker.kind === "missing_form").length;
  const missingUploadCount = blockers.filter((blocker) => blocker.kind === "missing_upload").length;
  const pendingApprovalCount = blockers.filter((blocker) => blocker.kind === "approval").length;
  const overdueTaskCount = blockers.filter((blocker) => blocker.kind === "overdue_task").length;
  const completedCount = currentTasks.length - incompleteTasks.length;
  const progress = currentTasks.length ? Math.round((completedCount / currentTasks.length) * 100) : 0;
  const score = Math.max(0, Math.min(100, progress - overdueTaskCount * 10 - blockers.filter((b) => b.kind === "blocked_task").length * 15 - (currentTasks.length === 0 ? 20 : 0)));
  const clientBlockers = blockers.filter((blocker) => blocker.owner === "client");

  let state: OnboardingHealthState = "on_track";
  if (currentTasks.length > 0 && incompleteTasks.length === 0 && blockers.length === 0) {
    state = "ready_to_launch";
  } else if (clientBlockers.length > 0) {
    state = "waiting_on_client";
  } else if (blockers.length > 0) {
    state = "blocked_internally";
  }

  const reminders = clientBlockers.map((blocker) => ({
    clientId: client.id,
    clientName: client.companyName,
    recipient: client.primaryContactEmail || null,
    subject: `Action needed for ${client.companyName} onboarding`,
    message: `Please complete: ${blocker.label}. This will help us keep your onboarding moving.`,
    blockerKind: blocker.kind,
    taskId: blocker.taskId,
  }));

  return {
    clientId: client.id,
    state,
    score,
    blockers,
    overdueTaskCount,
    missingFormCount,
    missingUploadCount,
    pendingApprovalCount,
    reminders,
  };
}
