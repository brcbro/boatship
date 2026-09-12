import type {
  Client,
  Task,
  AuthSession,
} from "@/types";
import { getStore, type DataStore } from "@/lib/store";

export interface McpContext {
  store: DataStore;
  session: AuthSession;
  mcpId: string;
  projectIds: Set<string> | null;
  scopes: Set<string>;
  identityId?: string;
}

function canSeeClient(context: McpContext, client: Client, tasks: Task[]) {
  if (context.projectIds && !context.projectIds.has(client.id)) return false;
  if (context.session.role === "admin") return true;
  if (context.session.role === "client") return context.session.clientId === client.id;
  return (
    client.assignedTeamMemberId === context.session.uid ||
    tasks.some((task) =>
      task.clientId === client.id &&
      (task.assignedTo === context.session.uid || task.watcherIds.includes(context.session.uid))
    )
  );
}

export async function createMcpContext(
  session: AuthSession,
  mcpId: string,
  projectIds?: string[],
  scopes: readonly string[] = ["tasks:read", "projects:read", "context:read"],
  identityId?: string
): Promise<McpContext> {
  return {
    store: await getStore(),
    session,
    mcpId,
    projectIds: projectIds?.length ? new Set(projectIds) : null,
    scopes: new Set(scopes),
    identityId,
  };
}

export function hasMcpScope(context: McpContext, scope: string) {
  return context.scopes.has(scope);
}

export function sanitizeForMcp<T>(value: T): T {
  const blocked = /pass(word|hash)?|secret|token|api.?key|credential|invite|content.?base64/i;
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

async function allVisibleData(context: McpContext) {
  const [clients, tasks, activity] = await Promise.all([
    context.store.listClients(),
    context.store.listAllTasks(),
    context.store.listAllActivity(),
  ]);
  const visibleClients = clients.filter((client) => canSeeClient(context, client, tasks));
  const ids = new Set(visibleClients.map((client) => client.id));
  return {
    clients: visibleClients,
    tasks: tasks.filter((task) => ids.has(task.clientId)),
    activity: activity.filter((entry) => ids.has(entry.clientId)),
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
      return task.clientId === context.session.clientId && task.assignedRole === "client";
    }
    return task.assignedTo === context.session.uid || task.watcherIds.includes(context.session.uid) ||
      client.assignedTeamMemberId === context.session.uid;
  });
}

export async function visibleClient(context: McpContext, clientId: string) {
  const client = await context.store.getClient(clientId);
  if (!client) return null;
  const tasks = await context.store.listTasks(clientId);
  return canSeeClient(context, client, tasks) ? client : null;
}

export async function visibleTask(context: McpContext, taskId: string) {
  const task = await context.store.getTask(taskId);
  if (!task) return null;
  const visible = await visibleTasks(context, task.clientId);
  return visible.some((item) => item.id === task.id) ? task : null;
}

export async function taskDetails(context: McpContext, taskId: string) {
  const task = await visibleTask(context, taskId);
  if (!task) return null;
  const client = await visibleClient(context, task.clientId);
  if (!client) return null;
  const [comments, activity, documents, forms] = await Promise.all([
    context.store.listTaskComments(task.id),
    context.store.listActivity(client.id),
    context.store.listDocuments(client.id),
    context.store.listForms(client.id),
  ]);
  return sanitizeForMcp({ task, client, comments, activity, documents, forms });
}

export async function progressEvidence(context: McpContext, taskId?: string) {
  const tasks = taskId ? ([await visibleTask(context, taskId)].filter(Boolean) as Task[]) : await visibleTasks(context);
  const evidence = await Promise.all(tasks.map(async (task) => {
    const [comments, activity, documents, forms] = await Promise.all([
      context.store.listTaskComments(task.id),
      context.store.listActivity(task.clientId),
      context.store.listDocuments(task.clientId),
      context.store.listForms(task.clientId),
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
  for (const client of data.clients) {
    if (JSON.stringify(client).toLowerCase().includes(q)) matches.push({ type: "client", client });
  }
  for (const task of data.tasks) {
    if (JSON.stringify(task).toLowerCase().includes(q)) matches.push({ type: "task", task });
  }
  for (const entry of data.activity) {
    if (JSON.stringify(entry).toLowerCase().includes(q)) matches.push({ type: "activity", entry });
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
    context.store.listTasks(client.id),
  ]);
  const comments = (await Promise.all(tasks.map((task) => context.store.listTaskComments(task.id)))).flat();
  return sanitizeForMcp({ clientId: client.id, comments, messages });
}

export async function projectContext(context: McpContext, clientId: string) {
  const client = await visibleClient(context, clientId);
  if (!client) return null;
  const [tasks, activity, documents, forms] = await Promise.all([
    visibleTasks(context, clientId),
    context.store.listActivity(clientId),
    context.store.listDocuments(clientId),
    context.store.listForms(clientId),
  ]);
  return sanitizeForMcp({ project: client, company: { name: client.companyName, contactEmail: client.primaryContactEmail, tags: client.tags }, tasks, activity, documents, forms });
}
