import { createHash, randomUUID } from "crypto";
import type { AuthSession, Task, TaskPriority, TaskStatus, TaskType } from "@/types";
import { hasPermission } from "@/lib/rbac";
import { requireClientAccess } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { createAccountingEntry, listAccountingEntries, updateAccountingEntry, validateAccountingInput } from "@/lib/accounting";
import { consumeHodiActionProposal, createHodiActionProposal, finishHodiActionProposal, releaseHodiActionProposal } from "@/lib/hodi-queue";

export type HodiAction =
  | "create_client"
  | "apply_template"
  | "create_task"
  | "update_task"
  | "assign_task"
  | "block_task"
  | "weekly_status_report"
  | "create_accounting_entry"
  | "update_accounting_entry";

type ActionPayload = Record<string, unknown>;

const PROPOSAL_TTL_MS = 15 * 60 * 1000;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown) {
  const result = text(value);
  return result || null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(payload: ActionPayload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function assertAction(value: unknown): asserts value is HodiAction {
  const actions: HodiAction[] = [
    "create_client",
    "apply_template",
    "create_task",
    "update_task",
    "assign_task",
    "block_task",
    "weekly_status_report",
    "create_accounting_entry",
    "update_accounting_entry",
  ];
  if (!actions.includes(value as HodiAction)) throw new Error("Unsupported Hodi action");
}

function assertCanManage(session: AuthSession) {
  if (!hasPermission(session, "clients.manage")) throw new Error("Forbidden");
}

function assertCanView(session: AuthSession) {
  if (!hasPermission(session, "clients.view")) throw new Error("Forbidden");
}

function assertCanManageAccounts(session: AuthSession) {
  if (session.role !== "admin") throw new Error("Forbidden");
}

function validateDueDate(value: unknown) {
  const dueDate = optionalText(value);
  if (dueDate && Number.isNaN(Date.parse(dueDate))) {
    throw new Error("dueDate must be a valid date");
  }
  return dueDate;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function taskDiff(task: Task, payload: ActionPayload) {
  const labels: Record<string, string> = {
    title: "Title", description: "Description", status: "Status", dueDate: "Due date", assignedTo: "Assignee", priority: "Priority",
  };
  return Object.keys(labels)
    .filter((key) => payload[key] !== undefined)
    .map((key) => ({ field: key, label: labels[key], before: displayValue(task[key as keyof Task]), after: displayValue(payload[key]) }));
}

async function requireClient(clientId: string) {
  const client = await (await getStore()).getClient(clientId);
  if (!client) throw new Error("Client not found");
  return client;
}

async function requireStaff(userId: string | null) {
  if (!userId) return null;
  const user = await (await getStore()).getUser(userId);
  if (!user || (user.role !== "admin" && user.role !== "team")) {
    throw new Error("Assigned user must be an active staff member");
  }
  return user;
}

async function requireTemplate(templateId: string) {
  const template = await (await getStore()).getTemplate(templateId);
  if (!template) throw new Error("Service template not found");
  if (template.publishStatus !== "published") throw new Error("Service template is not published");
  return template;
}

async function buildWeeklyReport(clientId: string) {
  const store = await getStore();
  const client = await requireClient(clientId);
  const [tasks, documents, forms, activity] = await Promise.all([
    store.listTasks(clientId),
    store.listDocuments(clientId),
    store.listForms(clientId),
    store.listActivity(clientId),
  ]);
  const now = Date.now();
  const completed = tasks.filter((task) => task.status === "completed");
  const blocked = tasks.filter((task) => task.status === "blocked");
  const overdue = tasks.filter(
    (task) =>
      task.status !== "completed" && task.dueDate && Date.parse(task.dueDate) < now
  );
  const submittedForms = forms.filter((form) => form.status !== "not_started");
  const approvedDocuments = documents.filter((document) => document.status === "approved");

  return {
    client: { id: client.id, name: client.name, companyName: client.companyName },
    generatedAt: new Date().toISOString(),
    summary: {
      tasks: { total: tasks.length, completed: completed.length, blocked: blocked.length, overdue: overdue.length },
      forms: { total: forms.length, submitted: submittedForms.length },
      documents: { total: documents.length, approved: approvedDocuments.length },
      recentActivityCount: activity.filter((entry) => Date.parse(entry.timestamp) >= now - 7 * 86400000).length,
    },
    blockers: blocked.map((task) => ({ id: task.id, title: task.title, note: task.internalNotes })),
    overdueTasks: overdue.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, assignedTo: task.assignedTo })),
    nextActions: tasks
      .filter((task) => task.status !== "completed")
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
      .slice(0, 5)
      .map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, assignedTo: task.assignedTo })),
  };
}

async function preview(action: HodiAction, payload: ActionPayload, session: AuthSession) {
  const clientId = text(payload.clientId);
  if (session.role === "team") {
    if (action === "create_client") {
      const assigneeId = optionalText(payload.assignedTeamMemberId) || session.uid;
      if (assigneeId !== session.uid) throw new Error("Team members can assign new clients only to themselves");
    } else if (["apply_template", "create_task", "weekly_status_report"].includes(action)) {
      if (clientId) await requireClientAccess(session, clientId);
    } else if (["update_task", "assign_task", "block_task"].includes(action)) {
      const task = await (await getStore()).getTask(text(payload.taskId));
      if (task) await requireClientAccess(session, task.clientId);
    }
  }
  switch (action) {
    case "create_client": {
      assertCanManage(session);
      const name = text(payload.name);
      const companyName = text(payload.companyName);
      const primaryContactEmail = text(payload.primaryContactEmail);
      if (!name || !companyName || !primaryContactEmail) {
        throw new Error("name, companyName, and primaryContactEmail are required");
      }
      const templateId = optionalText(payload.templateId);
      const assigneeId = optionalText(payload.assignedTeamMemberId) || session.uid;
      const [template, assignee] = await Promise.all([
        templateId ? requireTemplate(templateId) : null,
        requireStaff(assigneeId),
      ]);
      return {
        title: `Create ${companyName} as a client`,
        changes: [
          `Create client contact ${name} (${primaryContactEmail})`,
          `Assign ${assignee?.name || "the signed-in staff member"}`,
          template ? `Apply ${template.name} and create ${template.taskList.length} onboarding tasks` : "Create without a service template",
        ],
        diff: [
          { field: "client", label: "Client", before: "Does not exist", after: companyName },
          { field: "contact", label: "Primary contact", before: "Not set", after: `${name} (${primaryContactEmail})` },
          { field: "assignee", label: "Owner", before: "Not set", after: assignee?.name || "The signed-in staff member" },
        ],
      };
    }
    case "apply_template": {
      assertCanManage(session);
      const templateId = text(payload.templateId);
      if (!clientId || !templateId) throw new Error("clientId and templateId are required");
      const [client, template] = await Promise.all([requireClient(clientId), requireTemplate(templateId)]);
      return { title: `Apply ${template.name} to ${client.companyName}`, changes: [`Update the client service template`, `Create ${template.taskList.length} template tasks`], diff: [{ field: "template", label: "Service template", before: client.templateId || "Not set", after: template.name }, { field: "tasks", label: "Onboarding tasks", before: "No new tasks", after: `${template.taskList.length} tasks created` }] };
    }
    case "create_task": {
      assertCanManage(session);
      const title = text(payload.title);
      if (!clientId || !title) throw new Error("clientId and title are required");
      const [client, assignee] = await Promise.all([requireClient(clientId), requireStaff(optionalText(payload.assignedTo))]);
      const dueDate = validateDueDate(payload.dueDate);
      return { title: `Create task for ${client.companyName}`, changes: [`Create “${title}”`, assignee ? `Assign ${assignee.name}` : "Leave unassigned", dueDate ? `Set due date to ${dueDate}` : "No due date"], diff: [{ field: "task", label: "Task", before: "Does not exist", after: title }, { field: "assignee", label: "Assignee", before: "Not set", after: assignee?.name || "Unassigned" }, { field: "dueDate", label: "Due date", before: "Not set", after: dueDate || "Not set" }] };
    }
    case "update_task":
    case "assign_task":
    case "block_task": {
      assertCanManage(session);
      const taskId = text(payload.taskId);
      if (!taskId) throw new Error("taskId is required");
      const store = await getStore();
      const task = await store.getTask(taskId);
      if (!task) throw new Error("Task not found");
      const client = await requireClient(task.clientId);
      if (action === "assign_task") {
        const assignee = await requireStaff(optionalText(payload.assignedTo));
        if (!assignee) throw new Error("assignedTo is required");
        return { title: `Assign ${task.title}`, changes: [`Assign ${task.title} to ${assignee.name}`, `Client: ${client.companyName}`], diff: [{ field: "assignedTo", label: "Assignee", before: displayValue(task.assignedTo), after: assignee.name }] };
      }
      if (action === "block_task") {
        const note = text(payload.note);
        if (!note) throw new Error("A blocker note is required");
        return { title: `Mark ${task.title} blocked`, changes: [`Change task status to blocked`, `Add internal note: ${note}`], diff: [{ field: "status", label: "Status", before: task.status, after: "blocked" }, { field: "internalNotes", label: "Internal note", before: displayValue(task.internalNotes), after: note }] };
      }
      const diff = taskDiff(task, payload);
      const updates = diff.map((change) => `${change.label}: ${change.before} → ${change.after}`);
      if (updates.length === 0) throw new Error("Provide at least one supported task update");
      validateDueDate(payload.dueDate);
      if (payload.assignedTo !== undefined) await requireStaff(optionalText(payload.assignedTo));
      return { title: `Update ${task.title}`, changes: updates, diff };
    }
    case "weekly_status_report": {
      assertCanView(session);
      if (!clientId) throw new Error("clientId is required");
      const report = await buildWeeklyReport(clientId);
      return { title: `Generate weekly status report for ${report.client.companyName}`, changes: ["Generate a read-only report", `Includes ${report.summary.tasks.blocked} blockers and ${report.summary.tasks.overdue} overdue tasks`], diff: [{ field: "report", label: "Weekly status report", before: "Not generated", after: "Generated for review" }], report };
    }
    case "create_accounting_entry": {
      assertCanManageAccounts(session);
      const entry = validateAccountingInput(payload, session.uid);
      return { title: `Add ${entry.title} to accounting`, changes: [`Record ${entry.category.toUpperCase()} expense of ₹${entry.amount}`, `Paid by ${entry.paidByName}`, entry.splitMode === "equal" ? `Divide equally between ${entry.splits.map((allocation) => allocation.personName).join(", ")}` : `Assign to ${entry.splits[0]?.personName}`], diff: entry.splits.map((allocation) => ({ field: allocation.personId, label: allocation.personName, before: "No balance", after: `₹${allocation.amount} (${allocation.paidAmount >= allocation.amount ? "settled" : "owed"})` })) };
    }
    case "update_accounting_entry": {
      assertCanManageAccounts(session);
      const id = text(payload.id);
      if (!id) throw new Error("id is required");
      const existing = (await listAccountingEntries()).find((entry) => entry.id === id);
      if (!existing) throw new Error("Accounting entry not found");
      const entry = validateAccountingInput(payload, session.uid, existing);
      return { title: `Update ${existing.title}`, changes: [`Update ${entry.category.toUpperCase()} expense`, `Set payer to ${entry.paidByName}`, entry.splitMode === "equal" ? `Divide equally between ${entry.splits.length} people` : `Assign the bill to ${entry.splits[0]?.personName}`], diff: [{ field: "total", label: "Total", before: `₹${existing.amount}`, after: `₹${entry.amount}` }, ...entry.splits.map((allocation) => ({ field: allocation.personId, label: allocation.personName, before: "Current balance", after: `₹${allocation.amount} (${allocation.paidAmount >= allocation.amount ? "settled" : "owed"})` }))] };
    }
  }
}

export async function proposeHodiAction(action: HodiAction, payload: ActionPayload, session: AuthSession) {
  assertAction(action);
  const actionPreview = await preview(action, payload, session);
  const approvalToken = randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  await createHodiActionProposal({ approvalToken, action, payload, payloadHash: payloadHash(payload), userId: session.uid, preview: actionPreview, expiresAt });
  return { action, preview: actionPreview, approvalToken, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(), approvalRequired: true };
}

function taskPatch(payload: ActionPayload): Partial<Task> {
  const patch: Partial<Task> = {};
  if (payload.title !== undefined) patch.title = text(payload.title);
  if (payload.description !== undefined) patch.description = text(payload.description);
  if (payload.status !== undefined) {
    const status = text(payload.status) as TaskStatus;
    if (!["pending", "in_progress", "completed", "blocked"].includes(status)) throw new Error("Invalid task status");
    patch.status = status;
    patch.completedAt = status === "completed" ? new Date().toISOString() : null;
  }
  if (payload.dueDate !== undefined) patch.dueDate = validateDueDate(payload.dueDate);
  if (payload.assignedTo !== undefined) patch.assignedTo = optionalText(payload.assignedTo);
  if (payload.priority !== undefined) {
    const priority = text(payload.priority) as TaskPriority;
    if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error("Invalid task priority");
    patch.priority = priority;
  }
  return patch;
}

export async function executeHodiAction(
  action: HodiAction,
  payload: ActionPayload,
  approvalToken: string,
  session: AuthSession
) {
  assertAction(action);
  const claim = await consumeHodiActionProposal({ approvalToken, action, payloadHash: payloadHash(payload), userId: session.uid });
  try {
    await preview(action, payload, session);
    const store = await getStore();
    const complete = async <T>(result: T) => {
      await finishHodiActionProposal(claim.proposal.id);
      return result;
    };

  if (action === "weekly_status_report") {
    const report = await buildWeeklyReport(text(payload.clientId));
    await store.addActivity({ clientId: report.client.id, actorId: session.uid, actorName: session.name, action: "hodi.weekly_status_report_generated", meta: { proposalId: claim.proposal.id, summary: report.summary } });
    return complete({ report });
  }

  if (action === "create_accounting_entry") {
    const entry = await createAccountingEntry(payload, session.uid);
    await store.addActivity({ clientId: "accounting", actorId: session.uid, actorName: session.name, action: "hodi.accounting_entry_created", meta: { proposalId: claim.proposal.id, entryId: entry.id, title: entry.title, amount: entry.amount } });
    return complete({ entry });
  }

  if (action === "update_accounting_entry") {
    const id = text(payload.id);
    const entry = await updateAccountingEntry(id, payload, session.uid);
    await store.addActivity({ clientId: "accounting", actorId: session.uid, actorName: session.name, action: "hodi.accounting_entry_updated", meta: { proposalId: claim.proposal.id, entryId: entry.id, title: entry.title, amount: entry.amount } });
    return complete({ entry });
  }

  if (action === "create_client") {
    const templateId = optionalText(payload.templateId);
    const client = await store.createClient({
      name: text(payload.name), companyName: text(payload.companyName), primaryContactEmail: text(payload.primaryContactEmail).toLowerCase(),
      assignedTeamMemberId: optionalText(payload.assignedTeamMemberId) || session.uid, templateId, status: "not_started",
      tags: Array.isArray(payload.tags) ? payload.tags.map(text).filter(Boolean) : [],
      customFields: payload.discoveryBrief && typeof payload.discoveryBrief === "object" ? Object.fromEntries(Object.entries(payload.discoveryBrief as Record<string, unknown>).map(([key, value]) => [key, text(value)]).filter(([key, value]) => key && value)) : {},
    });
    const tasks = templateId ? await store.generateTasksFromTemplate(client.id, templateId, client.assignedTeamMemberId) : [];
    await store.addActivity({ clientId: client.id, actorId: session.uid, actorName: session.name, action: "hodi.client_created", meta: { proposalId: claim.proposal.id, templateId, taskCount: tasks.length } });
    return complete({ client, tasks });
  }

  if (action === "apply_template") {
    const clientId = text(payload.clientId);
    const templateId = text(payload.templateId);
    const client = await store.updateClient(clientId, { templateId });
    const tasks = await store.generateTasksFromTemplate(clientId, templateId, optionalText(payload.assignedTeamMemberId) || client.assignedTeamMemberId);
    await store.addActivity({ clientId, actorId: session.uid, actorName: session.name, action: "hodi.template_applied", meta: { proposalId: claim.proposal.id, templateId, taskCount: tasks.length } });
    return complete({ client, tasks });
  }

  if (action === "create_task") {
    const clientId = text(payload.clientId);
    const existing = await store.listTasks(clientId);
    const task = await store.createTask({
      clientId, title: text(payload.title), description: text(payload.description), type: (text(payload.type) || "internal") as TaskType,
      assignedTo: optionalText(payload.assignedTo), assignedRole: (text(payload.assignedRole) || "team") as Task["assignedRole"],
      status: (text(payload.status) || "pending") as TaskStatus, dueDate: validateDueDate(payload.dueDate),
      order: existing.length ? Math.max(...existing.map((item) => item.order)) + 1 : 1,
      priority: (text(payload.priority) || "medium") as TaskPriority, internalNotes: text(payload.internalNotes), section: optionalText(payload.section) || undefined,
      formTemplateId: optionalText(payload.formTemplateId), requiresUpload: Boolean(payload.requiresUpload),
    });
    await store.addActivity({ clientId, actorId: session.uid, actorName: session.name, action: "hodi.task_created", meta: { proposalId: claim.proposal.id, taskId: task.id, title: task.title } });
    return complete({ task });
  }

  const taskId = text(payload.taskId);
  const existing = await store.getTask(taskId);
  if (!existing) throw new Error("Task not found");
  let patch: Partial<Task>;
  let activityAction: string;
  if (action === "assign_task") {
    patch = { assignedTo: optionalText(payload.assignedTo) };
    activityAction = "hodi.task_assigned";
  } else if (action === "block_task") {
    const note = text(payload.note);
    patch = { status: "blocked", internalNotes: existing.internalNotes ? `${existing.internalNotes}\n${note}` : note };
    activityAction = "hodi.task_blocked";
  } else {
    patch = taskPatch(payload);
    activityAction = "hodi.task_updated";
  }
  const task = await store.updateTask(taskId, patch);
  await store.addActivity({ clientId: task.clientId, actorId: session.uid, actorName: session.name, action: activityAction, meta: { proposalId: claim.proposal.id, taskId: task.id, changes: patch } });
  return complete({ task });
  } catch (error) {
    await releaseHodiActionProposal(claim.proposal.id, claim.previousStatus);
    throw error;
  }
}
