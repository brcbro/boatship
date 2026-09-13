import { randomUUID } from "crypto";
import { executeTool, isComposioConfiguredForUser } from "@/lib/composio";
import { getStore } from "@/lib/store";
import type { Client, Task } from "@/types";

export type ProjectMilestone = {
  id: string;
  clientId: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: "planned" | "in_progress" | "completed" | "blocked";
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectApproval = {
  id: string;
  clientId: string;
  subject: string;
  description: string;
  kind: "document" | "design" | "release";
  status: "pending" | "approved" | "changes_requested";
  requestedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type CalendarSchedule = {
  id: string;
  clientId: string;
  title: string;
  start: string;
  end: string;
  description: string;
  createdBy: string;
  externalEventId: string | null;
  createdAt: string;
};

export type WorkspacePolicy = {
  id: string;
  name: string;
  description: string;
  allowedRoles: string[];
  enabled: boolean;
};

export type ProjectOpsData = {
  milestones: ProjectMilestone[];
  approvals: ProjectApproval[];
  schedules: CalendarSchedule[];
  workspace: { name: string; slug: string; policies: WorkspacePolicy[] };
};

const emptyOps = (): ProjectOpsData => ({
  milestones: [],
  approvals: [],
  schedules: [],
  workspace: {
    name: "Boatship Workspace",
    slug: "boatship",
    policies: [
      { id: "clients", name: "Client data", description: "View and manage client records.", allowedRoles: ["admin", "team"], enabled: true },
      { id: "approvals", name: "Client approvals", description: "Request and review approval decisions.", allowedRoles: ["admin", "team", "client"], enabled: true },
      { id: "reports", name: "Reports and exports", description: "Generate evidence-based status reports.", allowedRoles: ["admin", "team"], enabled: true },
    ],
  },
});

async function readOps() {
  const store = await getStore();
  const current = await store.readProjectOps<Partial<ProjectOpsData> & { [key: string]: unknown }>();
  return { store, data: { ...emptyOps(), ...current, workspace: { ...emptyOps().workspace, ...(current.workspace || {}) } } };
}

export async function listProjectOps() {
  const { data } = await readOps();
  return data;
}

export async function createMilestone(input: Omit<ProjectMilestone, "id" | "createdAt" | "updatedAt">) {
  const { store } = await readOps();
  const timestamp = new Date().toISOString();
  const milestone = { ...input, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp };
  await store.mutateProjectOps<ProjectOpsData>((data) => {
    const next = { ...emptyOps(), ...data };
    next.milestones = [...(next.milestones || []), milestone];
    Object.assign(data, next);
  });
  return milestone;
}

export async function createApproval(input: Omit<ProjectApproval, "id" | "createdAt" | "status" | "reviewedBy" | "reviewedAt">) {
  const { store } = await readOps();
  const approval: ProjectApproval = { ...input, id: randomUUID(), status: "pending", reviewedBy: null, reviewedAt: null, createdAt: new Date().toISOString() };
  await store.mutateProjectOps<ProjectOpsData>((data) => {
    const next = { ...emptyOps(), ...data };
    next.approvals = [...(next.approvals || []), approval];
    Object.assign(data, next);
  });
  return approval;
}

export async function updateApproval(id: string, status: ProjectApproval["status"], reviewedBy: string) {
  const { store } = await readOps();
  let updated: ProjectApproval | null = null;
  await store.mutateProjectOps<ProjectOpsData>((data) => {
    const next = { ...emptyOps(), ...data };
    next.approvals = (next.approvals || []).map((item) => item.id === id ? (updated = { ...item, status, reviewedBy, reviewedAt: new Date().toISOString() }) : item);
    Object.assign(data, next);
  });
  if (!updated) throw new Error("Approval not found");
  return updated;
}

export function healthScore(client: Client, tasks: Task[], ops: ProjectOpsData, now = Date.now()) {
  const open = tasks.filter((task) => task.status !== "completed");
  const overdue = open.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < now).length;
  const blocked = open.filter((task) => task.status === "blocked").length;
  const approvals = ops.approvals.filter((approval) => approval.clientId === client.id && approval.status === "pending").length;
  const completed = tasks.length ? tasks.filter((task) => task.status === "completed").length / tasks.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(completed * 65 - overdue * 8 - blocked * 12 - approvals * 5 + (client.status === "on_hold" ? -20 : 35))));
  return { score, label: score >= 75 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk", overdue, blocked, pendingApprovals: approvals, completed: Math.round(completed * 100) };
}

export async function weeklyEvidenceReport(clientId?: string) {
  const store = await getStore();
  const ops = await listProjectOps();
  const clients = clientId ? [await store.getClient(clientId)].filter(Boolean) as Client[] : await store.listClients();
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return Promise.all(clients.map(async (client) => {
    const tasks = await store.listTasks(client.id);
    const activity = (await store.listActivity(client.id)).filter((entry) => new Date(entry.timestamp).getTime() >= since);
    const health = healthScore(client, tasks, ops);
    return { clientId: client.id, companyName: client.companyName, health, completedTasks: tasks.filter((task) => task.status === "completed" && task.completedAt && new Date(task.completedAt).getTime() >= since).length, activeTasks: tasks.filter((task) => task.status !== "completed").length, evidenceCount: activity.length, activity: activity.slice(0, 30) };
  }));
}

export async function executeProjectIntegration(input: { userId: string; action: "calendar" | "docs" | "sheets" | "telegram"; arguments: Record<string, unknown> }) {
  if (!(await isComposioConfiguredForUser(input.userId))) return { connected: false, message: "Composio is not configured for this user; export the prepared payload manually.", payload: input.arguments };
  const tools = { calendar: "GOOGLECALENDAR_CREATE_EVENT", docs: "GOOGLEDOCS_CREATE_DOCUMENT", sheets: "GOOGLESHEETS_APPEND_ROW", telegram: "TELEGRAM_BOT_SEND_MESSAGE" } as const;
  const result = await executeTool({ boatshipUid: input.userId, toolSlug: tools[input.action], arguments: input.arguments });
  return { connected: true, result };
}
