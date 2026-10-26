import type {
  ActivityLog,
  Client,
  DocumentRecord,
  FormSubmission,
  Task,
  AuthSession,
} from "@/types";
import { getStore, type DataStore } from "@/lib/store";
import { filterAssignedClients } from "@/lib/client-access";
import { clientCanSeeDocument, clientCanSeeTask, clientSafeActivity } from "@/lib/client-projection";
import { hasPermission } from "@/lib/rbac";

export interface McpContext {
  store: DataStore;
  session: AuthSession;
  mcpId: string;
  projectIds: Set<string> | null;
  scopes: Set<string>;
  identityId?: string;
  assignedClientIds: Set<string> | null;
}

function canSeeClient(context: McpContext, client: Client) {
  if (context.projectIds && !context.projectIds.has(client.id)) return false;
  if (context.session.role === "admin") return true;
  if (context.session.role === "client") return context.session.clientId === client.id;
  if (!hasPermission(context.session, "clients.view")) return false;
  return context.assignedClientIds?.has(client.id) ?? false;
}

export async function createMcpContext(
  session: AuthSession,
  mcpId: string,
  projectIds?: string[],
  scopes: readonly string[] = ["tasks:read", "projects:read", "context:read"],
  identityId?: string
): Promise<McpContext> {
  const store = await getStore();
  const assignedClientIds = session.role === "team"
    ? new Set((await filterAssignedClients(session, await store.listClients())).map((client) => client.id))
    : null;
  return {
    store,
    session,
    mcpId,
    projectIds: projectIds?.length ? new Set(projectIds) : null,
    scopes: new Set(scopes),
    identityId,
    assignedClientIds,
  };
}

export function hasMcpScope(context: McpContext, scope: string) {
  return context.scopes.has(scope);
}

/**
 * Removes secrets and staff-only internal notes from anything an MCP tool
 * returns. Internal notes are withheld from every MCP token, staff included,
 * so no tool path can hand them to a client token by accident.
 */
export function sanitizeForMcp<T>(value: T): T {
  const blocked = /pass(word|hash)?|secret|token|api.?key|credential|invite|content.?base64|^internalNotes$/i;
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([key]) => !blocked.test(key))
        .map(([key, item]) => [key, visit(item)])
    );
  };
  return visit(value) as T;
}

const isClientToken = (context: McpContext) => context.session.role === "client";

/** A client token's view of a task: staff-only fields are emptied so the Task shape is kept. */
function mcpTask(context: McpContext, task: Task): Task {
  if (!isClientToken(context)) return task;
  return { ...task, internalNotes: "", watcherIds: [], escalatedAt: null, reminderSentAt: null, metadata: undefined };
}

/** Records of one client limited to what the token may see; staff tokens get them unchanged. */
async function clientRecords(context: McpContext, clientId: string) {
  const [activity, documents, forms] = await Promise.all([
    context.store.listActivity(clientId),
    context.store.listDocuments(clientId),
    context.store.listForms(clientId),
  ]);
  if (!isClientToken(context)) return { activity, documents, forms };
  return scopeForClient(await context.store.listTasks(clientId), activity, documents, forms);
}

function scopeForClient(tasks: Task[], activity: ActivityLog[], documents: DocumentRecord[], forms: FormSubmission[]) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const visibleDocuments = documents.filter((document) => clientCanSeeDocument(document, tasksById));
  return {
    activity: clientSafeActivity(activity, tasksById, new Map(documents.map((document) => [document.id, document]))),
    documents: visibleDocuments,
    forms: forms.filter((form) => !form.taskId || clientCanSeeTask(tasksById.get(form.taskId))),
  };
}

async function allVisibleData(context: McpContext) {
  const [clients, tasks, activity] = await Promise.all([
    context.store.listClients(),
    context.store.listAllTasks(),
    context.store.listAllActivity(),
  ]);
  const visibleClients = clients.filter((client) => canSeeClient(context, client));
  const ids = new Set(visibleClients.map((client) => client.id));
  const clientTasks = tasks.filter((task) => ids.has(task.clientId));
  const clientActivity = activity.filter((entry) => ids.has(entry.clientId));
  if (!isClientToken(context)) return { clients: visibleClients, tasks: clientTasks, activity: clientActivity };
  const documents = (await Promise.all(visibleClients.map((client) => context.store.listDocuments(client.id)))).flat();
  return {
    clients: visibleClients,
    tasks: (await visibleTasks(context)),
    activity: clientSafeActivity(clientActivity, new Map(clientTasks.map((task) => [task.id, task])), new Map(documents.map((document) => [document.id, document]))),
  };
}

export async function visibleTasks(context: McpContext, clientId?: string) {
  const [tasks, clients] = await Promise.all([
    context.store.listAllTasks(),
    context.store.listClients(),
  ]);
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  return tasks.filter((task) => {
    if (clientId && task.clientId !== clientId) return false;
    const client = clientMap.get(task.clientId);
    if (!client) return false;
    if (context.projectIds && !context.projectIds.has(client.id)) return false;
    if (context.session.role === "admin") return true;
    if (context.session.role === "client") {
      return task.clientId === context.session.clientId && task.assignedRole === "client" && clientCanSeeTask(task);
    }
    if (!hasPermission(context.session, "clients.view")) return false;
    return context.assignedClientIds?.has(client.id) ?? false;
  }).map((task) => mcpTask(context, task));
}

export async function visibleClient(context: McpContext, clientId: string) {
  const client = await context.store.getClient(clientId);
  if (!client) return null;
  return canSeeClient(context, client) ? client : null;
}

export async function visibleTask(context: McpContext, taskId: string) {
  const task = await context.store.getTask(taskId);
  if (!task) return null;
  const visible = await visibleTasks(context, task.clientId);
  return visible.find((item) => item.id === task.id) ?? null;
}

export async function taskDetails(context: McpContext, taskId: string) {
  const task = await visibleTask(context, taskId);
  if (!task) return null;
  const client = await visibleClient(context, task.clientId);
  if (!client) return null;
  const [comments, { activity, documents, forms }] = await Promise.all([
    context.store.listTaskComments(task.id),
    clientRecords(context, client.id),
  ]);
  return sanitizeForMcp({ task, client, comments, activity, documents, forms });
}

export async function progressEvidence(context: McpContext, taskId?: string) {
  const tasks = taskId ? ([await visibleTask(context, taskId)].filter(Boolean) as Task[]) : await visibleTasks(context);
  const evidence = await Promise.all(tasks.map(async (task) => {
    const [comments, { activity, documents, forms }] = await Promise.all([
      context.store.listTaskComments(task.id),
      clientRecords(context, task.clientId),
    ]);
    return {
      taskId: task.id,
      status: task.status,
      completedAt: task.completedAt,
      subtasks: task.subtasks,
      comments,
      activity: activity.filter((entry) => entry.meta?.taskId === task.id || entry.action.toLowerCase().includes("task")),
      documents: documents.filter((doc) => doc.taskId === task.id),
      forms: forms.filter((form) => form.taskId === task.id),
      source: "Boatship records only; no agent summary or Git validation",
    };
  }));
  return sanitizeForMcp(evidence);
}

export async function searchContext(context: McpContext, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const data = await allVisibleData(context);
  const matches: Array<Record<string, unknown>> = [];
  // Match against what the token may see, so a hidden field cannot act as a search oracle.
  const searchable = <T>(value: T) => JSON.stringify(sanitizeForMcp(value)).toLowerCase();
  for (const client of data.clients) {
    if (searchable(client).includes(q)) matches.push({ type: "client", client });
  }
  for (const task of data.tasks) {
    if (searchable(task).includes(q)) matches.push({ type: "task", task });
  }
  for (const entry of data.activity) {
    if (searchable(entry).includes(q)) matches.push({ type: "activity", entry });
  }
  for (const task of data.tasks) {
    const comments = await context.store.listTaskComments(task.id);
    for (const comment of comments) {
      if (comment.body.toLowerCase().includes(q)) matches.push({ type: "conversation", comment });
    }
  }
  for (const client of data.clients) {
    const [messages] = await Promise.all([context.store.listMessages(client.id)]);
    for (const message of messages) {
      if (message.body.toLowerCase().includes(q)) matches.push({ type: "conversation", message });
    }
  }
  return sanitizeForMcp(matches.slice(0, 50));
}

export async function authorizedConversation(context: McpContext, input: { taskId?: string; clientId?: string }) {
  if (input.taskId) {
    const task = await visibleTask(context, input.taskId);
    if (!task) return null;
    const [comments, messages] = await Promise.all([
      context.store.listTaskComments(task.id),
      context.store.listMessages(task.clientId),
    ]);
    return sanitizeForMcp({ taskId: task.id, clientId: task.clientId, comments, messages });
  }
  if (!input.clientId) return null;
  const client = await visibleClient(context, input.clientId);
  if (!client) return null;
  const [messages, tasks] = await Promise.all([
    context.store.listMessages(client.id),
    isClientToken(context) ? visibleTasks(context, client.id) : context.store.listTasks(client.id),
  ]);
  const comments = (await Promise.all(tasks.map((task) => context.store.listTaskComments(task.id)))).flat();
  return sanitizeForMcp({ clientId: client.id, comments, messages });
}

export async function projectContext(context: McpContext, clientId: string) {
  const client = await visibleClient(context, clientId);
  if (!client) return null;
  const [tasks, { activity, documents, forms }] = await Promise.all([
    visibleTasks(context, clientId),
    clientRecords(context, clientId),
  ]);
  return sanitizeForMcp({ project: client, company: { name: client.companyName, contactEmail: client.primaryContactEmail, tags: client.tags }, tasks, activity, documents, forms });
}
