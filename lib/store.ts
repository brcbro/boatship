import { randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { promises as fs } from "fs";
import path from "path";
import type {
  ActivityLog,
  AgentChatMessage,
  AgentChatSession,
  AppNotification,
  AppUser,
  Client,
  ClientStatus,
  DocumentRecord,
  FormSubmission,
  FormTemplate,
  IntegrationRun,
  MessageClientSummary,
  NotificationKind,
  OnboardingTemplate,
  PipelineStage,
  PortalMessage,
  SavedSmartList,
  Task,
  TaskComment,
  TaskPriority,
  TaskStatus,
  TaskSubtask,
  Vessel,
  WebhookDelivery,
  WebhookEndpoint,
} from "@/types";
import { calcProgress } from "@/lib/utils";
import { SEED_FORM_TEMPLATES, SEED_ONBOARDING_TEMPLATES } from "@/lib/seed-templates";
import { getPrisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { bumpRedisCacheVersion } from "@/lib/redis-cache";
import { webhookRetry } from "@/lib/webhook-retry";
import type {
  NotificationRecord as PrismaNotificationRecord,
  UserProfile as PrismaUserProfile,
} from "@/generated/prisma/client";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

export type StoreData = {
  users: AppUser[];
  clients: Client[];
  tasks: Task[];
  documents: DocumentRecord[];
  formTemplates: FormTemplate[];
  forms: FormSubmission[];
  templates: OnboardingTemplate[];
  activity: ActivityLog[];
  taskComments: TaskComment[];
  notifications: AppNotification[];
  messages: PortalMessage[];
  vessels: Vessel[];
  webhooks: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  integrationRuns: IntegrationRun[];
  smartLists: SavedSmartList[];
  agentChatMessages: AgentChatMessage[];
  agentChatSessions: AgentChatSession[];
  /** Feature-slice data that is intentionally kept in the Neon StoreSnapshot. */
  projectOps: Record<string, unknown>;
};

function now() {
  return new Date().toISOString();
}

function relationalStoreUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  // P2021/P2022 let application code and the schema migration be deployed in
  // either order. Other database failures must surface instead of silently
  // falling back to a large snapshot read.
  const code = (error as { code?: unknown }).code;
  if (code === "P2021" || code === "P2022" || code === "42P01" || code === "42703") {
    return true;
  }

  // Driver-adapter errors do not always preserve Prisma/Postgres' code on the
  // outer error. Restrict the message fallback to the two normalized tables so
  // unrelated query errors still surface normally.
  const message = error instanceof Error ? error.message : String(error);
  return (
    /(?:relation|table).*(?:UserProfile|NotificationRecord).*(?:does not exist|missing)/i.test(
      message
    ) ||
    /(?:UserProfile|NotificationRecord).*(?:relation|table).*(?:does not exist|missing)/i.test(
      message
    )
  );
}

function userProfileData(user: AppUser) {
  return {
    uid: user.uid,
    email: user.email.trim().toLowerCase(),
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    createdAt: new Date(user.createdAt),
    inviteToken: user.inviteToken ?? null,
    inviteTokenExpiresAt: user.inviteTokenExpiresAt
      ? new Date(user.inviteTokenExpiresAt)
      : null,
    mustResetPassword: user.mustResetPassword ?? false,
    password: user.password ?? null,
    passwordHash: user.passwordHash ?? null,
    permissions: user.permissions ?? [],
    digestEnabled: user.digestEnabled ?? false,
    lastDigestAt: user.lastDigestAt ? new Date(user.lastDigestAt) : null,
  };
}

function appUserFromProfile(user: PrismaUserProfile): AppUser {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role as AppUser["role"],
    clientId: user.clientId,
    createdAt: user.createdAt.toISOString(),
    inviteToken: user.inviteToken,
    inviteTokenExpiresAt: user.inviteTokenExpiresAt?.toISOString() ?? null,
    mustResetPassword: user.mustResetPassword,
    password: user.password,
    passwordHash: user.passwordHash,
    permissions: user.permissions as NonNullable<AppUser["permissions"]>,
    digestEnabled: user.digestEnabled,
    lastDigestAt: user.lastDigestAt?.toISOString() ?? null,
  };
}

function appNotificationFromRecord(notification: PrismaNotificationRecord): AppNotification {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind as NotificationKind,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    clientId: notification.clientId,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

function emptyStore(): StoreData {
  return {
    users: [],
    clients: [],
    tasks: [],
    documents: [],
    formTemplates: [],
    forms: [],
    templates: [],
    activity: [],
    taskComments: [],
    notifications: [],
    messages: [],
    vessels: [],
    webhooks: [],
    webhookDeliveries: [],
    integrationRuns: [],
    smartLists: [],
    agentChatMessages: [],
    agentChatSessions: [],
    projectOps: {},
  };
}

function migrateClient(raw: Partial<Client> & { id: string }): Client {
  const status = raw.status || "not_started";
  const stage: PipelineStage =
    raw.pipelineStage ||
    (status === "completed"
      ? "done"
      : status === "in_progress"
        ? "compliance"
        : status === "on_hold"
          ? "intake"
          : "intake");
  return {
    id: raw.id,
    name: raw.name || "",
    companyName: raw.companyName || "",
    primaryContactEmail: raw.primaryContactEmail || "",
    status,
    pipelineStage: stage,
    assignedTeamMemberId: raw.assignedTeamMemberId ?? null,
    templateId: raw.templateId ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    customFields:
      raw.customFields && typeof raw.customFields === "object" ? raw.customFields : {},
    driveFolderId: raw.driveFolderId ?? null,
    driveFolderUrl: raw.driveFolderUrl ?? null,
    pauseReason: raw.pauseReason ?? null,
    pausedAt: raw.pausedAt ?? null,
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || now(),
  };
}

function migrateTask(raw: Partial<Task> & { id: string; clientId: string }): Task {
  const priority: TaskPriority =
    raw.priority === "low" ||
    raw.priority === "medium" ||
    raw.priority === "high" ||
    raw.priority === "urgent"
      ? raw.priority
      : "medium";
  return {
    id: raw.id,
    clientId: raw.clientId,
    title: raw.title || "",
    description: raw.description || "",
    type: raw.type || "internal",
    assignedTo: raw.assignedTo ?? null,
    assignedRole: raw.assignedRole || "team",
    status: raw.status || "pending",
    priority,
    dueDate: raw.dueDate ?? null,
    order: raw.order ?? 0,
    section:
      raw.section ||
      (raw.type === "client_facing" ? "Client tasks" : "Internal tasks"),
    internalNotes: raw.internalNotes || "",
    formTemplateId: raw.formTemplateId ?? null,
    requiresUpload: Boolean(raw.requiresUpload),
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
    dependsOnTaskIds: Array.isArray(raw.dependsOnTaskIds) ? raw.dependsOnTaskIds : [],
    watcherIds: Array.isArray(raw.watcherIds) ? raw.watcherIds : [],
    reminderSentAt: raw.reminderSentAt ?? null,
    escalatedAt: raw.escalatedAt ?? null,
    createdAt: raw.createdAt || now(),
    completedAt: raw.completedAt ?? null,
  };
}

function migrateDocument(
  raw: Partial<DocumentRecord> & { id: string; clientId: string }
): DocumentRecord {
  return {
    id: raw.id,
    clientId: raw.clientId,
    taskId: raw.taskId ?? null,
    fileName: raw.fileName || "",
    storagePath: raw.storagePath || "",
    uploadedBy: raw.uploadedBy || "",
    status: raw.status || "pending_review",
    reviewNote: raw.reviewNote || "",
    uploadedAt: raw.uploadedAt || now(),
    contentType: raw.contentType || "application/octet-stream",
    size: raw.size || 0,
    documentType: raw.documentType ?? null,
    expiresAt: raw.expiresAt ?? null,
    expiryAlertSentAt: raw.expiryAlertSentAt ?? null,
    versions: Array.isArray(raw.versions)
      ? raw.versions
      : raw.storagePath
        ? [
            {
              storagePath: raw.storagePath,
              fileName: raw.fileName || "",
              uploadedAt: raw.uploadedAt || now(),
              uploadedBy: raw.uploadedBy || "",
              contentType: raw.contentType || "application/octet-stream",
              size: raw.size || 0,
            },
        ]
        : [],
    contentBase64: raw.contentBase64 ?? null,
  };
}

function migrateTemplate(
  raw: Partial<OnboardingTemplate> & { id: string; name: string; taskList: OnboardingTemplate["taskList"] }
): OnboardingTemplate {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    taskList: raw.taskList || [],
    version: raw.version ?? 1,
    publishStatus: raw.publishStatus || "published",
    parentTemplateId: raw.parentTemplateId ?? null,
    industry: raw.industry ?? null,
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || now(),
  };
}

function migrateForm(raw: Partial<FormSubmission> & { id: string; clientId: string }): FormSubmission {
  return {
    id: raw.id,
    clientId: raw.clientId,
    formTemplateId: raw.formTemplateId || "",
    taskId: raw.taskId ?? null,
    responses: raw.responses || {},
    status: raw.status || "not_started",
    riskScore: raw.riskScore ?? null,
    submittedAt: raw.submittedAt ?? null,
    reviewedAt: raw.reviewedAt ?? null,
    reviewNote: raw.reviewNote || "",
  };
}

function migrateComment(
  raw: Partial<TaskComment> & { id: string; taskId: string; clientId: string }
): TaskComment {
  return {
    id: raw.id,
    taskId: raw.taskId,
    clientId: raw.clientId,
    authorId: raw.authorId || "",
    authorName: raw.authorName || "",
    body: raw.body || "",
    mentionUserIds: Array.isArray(raw.mentionUserIds) ? raw.mentionUserIds : [],
    createdAt: raw.createdAt || now(),
  };
}

async function ensureSeed(data: StoreData, seedDemoUsers = false) {
  const ts = now();

  if (!Array.isArray(data.taskComments)) data.taskComments = [];
  if (!Array.isArray(data.notifications)) data.notifications = [];
  if (!Array.isArray(data.messages)) data.messages = [];
  if (!Array.isArray(data.vessels)) data.vessels = [];
  if (!Array.isArray(data.webhooks)) data.webhooks = [];
  if (!Array.isArray(data.webhookDeliveries)) data.webhookDeliveries = [];
  if (!Array.isArray(data.integrationRuns)) data.integrationRuns = [];
  if (!Array.isArray(data.smartLists)) data.smartLists = [];
  if (!Array.isArray(data.agentChatMessages)) data.agentChatMessages = [];
  if (!Array.isArray(data.agentChatSessions)) data.agentChatSessions = [];
  if (!data.projectOps || typeof data.projectOps !== "object") data.projectOps = {};

  data.clients = data.clients.map((c) => migrateClient(c));
  data.tasks = data.tasks.map((t) => migrateTask(t));
  data.documents = data.documents.map((d) => migrateDocument(d));
  data.templates = data.templates.map((t) => migrateTemplate(t));
  data.forms = data.forms.map((f) => migrateForm(f));
  data.taskComments = data.taskComments.map((c) => migrateComment(c));

  for (const form of SEED_FORM_TEMPLATES) {
    const existing = data.formTemplates.find((f) => f.id === form.id);
    if (!existing) {
      data.formTemplates.push({
        ...form,
        createdAt: ts,
        updatedAt: ts,
      });
    } else {
      Object.assign(existing, {
        ...form,
        createdAt: existing.createdAt || ts,
        updatedAt: ts,
      });
    }
  }

  for (const template of SEED_ONBOARDING_TEMPLATES) {
    const existing = data.templates.find((t) => t.id === template.id);
    if (!existing) {
      data.templates.push(
        migrateTemplate({
          ...template,
          createdAt: ts,
          updatedAt: ts,
        })
      );
    } else {
      Object.assign(
        existing,
        migrateTemplate({
          ...template,
          createdAt: existing.createdAt || ts,
          updatedAt: ts,
        })
      );
    }
  }

  if (seedDemoUsers && data.users.length === 0) {
    data.users.push({
      uid: "seed_admin",
      email: "admin@boatship.local",
      name: "Admin User",
      role: "admin",
      clientId: null,
      createdAt: ts,
      passwordHash: hashPassword("admin123"),
      digestEnabled: true,
    });

    data.users.push({
      uid: "seed_team",
      email: "team@boatship.local",
      name: "Alex Rivera",
      role: "team",
      clientId: null,
      createdAt: ts,
      passwordHash: hashPassword("team123"),
      digestEnabled: true,
    });
  }
}

export interface DataStore {
  getUser(uid: string): Promise<AppUser | null>;
  getUserByEmail(email: string): Promise<AppUser | null>;
  getUserByInviteToken(token: string): Promise<AppUser | null>;
  listUsers(): Promise<AppUser[]>;
  upsertUser(user: AppUser): Promise<AppUser>;
  deleteUser(uid: string): Promise<void>;

  listClients(filter?: {
    status?: ClientStatus;
    assignedTeamMemberId?: string;
    q?: string;
    tag?: string;
    pipelineStage?: PipelineStage;
  }): Promise<Client[]>;
  listClientMessageSummaries(): Promise<MessageClientSummary[]>;
  getClient(id: string): Promise<Client | null>;
  createClient(
    input: Omit<
      Client,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "status"
      | "tags"
      | "customFields"
      | "driveFolderId"
      | "driveFolderUrl"
      | "pipelineStage"
      | "pauseReason"
      | "pausedAt"
    > & {
      status?: ClientStatus;
      pipelineStage?: PipelineStage;
      templateId?: string | null;
      tags?: string[];
      customFields?: Record<string, string>;
      pauseReason?: string | null;
      pausedAt?: string | null;
    }
  ): Promise<Client>;
  updateClient(id: string, patch: Partial<Client>): Promise<Client>;
  bulkUpdateClients(
    ids: string[],
    patch: Partial<Pick<Client, "status" | "assignedTeamMemberId" | "tags" | "pipelineStage">>
  ): Promise<Client[]>;
  deleteClientCascade(id: string): Promise<void>;

  listTemplates(): Promise<OnboardingTemplate[]>;
  getTemplate(id: string): Promise<OnboardingTemplate | null>;
  upsertTemplate(template: OnboardingTemplate): Promise<OnboardingTemplate>;
  deleteTemplate(id: string): Promise<void>;

  listTasks(clientId: string): Promise<Task[]>;
  listAllTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(
    input: Omit<
      Task,
      | "id"
      | "createdAt"
      | "completedAt"
      | "internalNotes"
      | "section"
      | "subtasks"
      | "dependsOnTaskIds"
      | "reminderSentAt"
      | "priority"
      | "watcherIds"
      | "escalatedAt"
    > & {
      internalNotes?: string;
      section?: string;
      subtasks?: TaskSubtask[];
      dependsOnTaskIds?: string[];
      reminderSentAt?: string | null;
      priority?: TaskPriority;
      watcherIds?: string[];
      escalatedAt?: string | null;
    }
  ): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  generateTasksFromTemplate(
    clientId: string,
    templateId: string,
    assignedTeamMemberId: string | null
  ): Promise<Task[]>;

  listDocuments(clientId: string): Promise<DocumentRecord[]>;
  listAllDocuments(): Promise<DocumentRecord[]>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  createDocument(
    doc: Omit<
      DocumentRecord,
      | "id"
      | "uploadedAt"
      | "status"
      | "reviewNote"
      | "versions"
      | "documentType"
      | "expiresAt"
      | "expiryAlertSentAt"
      | "contentBase64"
    > & {
      status?: DocumentRecord["status"];
      reviewNote?: string;
      documentType?: string | null;
      expiresAt?: string | null;
      expiryAlertSentAt?: string | null;
      versions?: DocumentRecord["versions"];
      contentBase64?: string | null;
    }
  ): Promise<DocumentRecord>;
  updateDocument(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;

  listFormTemplates(): Promise<FormTemplate[]>;
  getFormTemplate(id: string): Promise<FormTemplate | null>;
  upsertFormTemplate(template: FormTemplate): Promise<FormTemplate>;
  deleteFormTemplate(id: string): Promise<void>;

  listForms(clientId: string): Promise<FormSubmission[]>;
  listAllForms(): Promise<FormSubmission[]>;
  getForm(id: string): Promise<FormSubmission | null>;
  createForm(
    form: Omit<
      FormSubmission,
      "id" | "submittedAt" | "reviewedAt" | "reviewNote" | "status" | "responses" | "riskScore"
    > & {
      responses?: FormSubmission["responses"];
      status?: FormSubmission["status"];
      riskScore?: number | null;
    }
  ): Promise<FormSubmission>;
  updateForm(id: string, patch: Partial<FormSubmission>): Promise<FormSubmission>;

  listActivity(clientId: string): Promise<ActivityLog[]>;
  listAllActivity(): Promise<ActivityLog[]>;
  addActivity(
    entry: Omit<ActivityLog, "id" | "timestamp"> & { timestamp?: string }
  ): Promise<ActivityLog>;

  listTaskComments(taskId: string): Promise<TaskComment[]>;
  addTaskComment(input: Omit<TaskComment, "id" | "createdAt">): Promise<TaskComment>;

  listNotifications(userId: string): Promise<AppNotification[]>;
  createNotification(
    input: Omit<AppNotification, "id" | "createdAt" | "readAt"> & { readAt?: string | null }
  ): Promise<AppNotification>;
  markNotificationRead(id: string, userId: string): Promise<AppNotification>;
  markAllNotificationsRead(userId: string): Promise<number>;

  listMessages(clientId: string): Promise<PortalMessage[]>;
  addMessage(input: Omit<PortalMessage, "id" | "createdAt">): Promise<PortalMessage>;

  listVessels(clientId: string): Promise<Vessel[]>;
  getVessel(id: string): Promise<Vessel | null>;
  upsertVessel(vessel: Vessel): Promise<Vessel>;
  deleteVessel(id: string): Promise<void>;

  listWebhooks(): Promise<WebhookEndpoint[]>;
  getWebhook(id: string): Promise<WebhookEndpoint | null>;
  upsertWebhook(hook: WebhookEndpoint): Promise<WebhookEndpoint>;
  deleteWebhook(id: string): Promise<void>;
  addWebhookDeliveries(entries: Array<Omit<WebhookDelivery, "id" | "createdAt">>): Promise<WebhookDelivery[]>;
  listWebhookDeliveries(webhookId?: string): Promise<WebhookDelivery[]>;
  claimWebhookDeliveries(limit: number): Promise<WebhookDelivery[]>;
  finishWebhookDeliveries(results: Array<{ id: string; leaseToken: string; statusCode: number | null; error: string | null }>): Promise<void>;

  addIntegrationRun(entry: Omit<IntegrationRun, "id" | "createdAt">): Promise<IntegrationRun>;
  listIntegrationRuns(limit?: number): Promise<IntegrationRun[]>;

  listSmartLists(ownerId: string): Promise<SavedSmartList[]>;
  upsertSmartList(list: SavedSmartList): Promise<SavedSmartList>;
  deleteSmartList(id: string): Promise<void>;

  listAgentChatSessions(userId: string): Promise<AgentChatSession[]>;
  getAgentChatSession(id: string, userId: string): Promise<AgentChatSession | null>;
  createAgentChatSession(userId: string, title?: string): Promise<AgentChatSession>;
  deleteAgentChatSession(id: string, userId: string): Promise<void>;
  listAgentChatMessages(
    userId: string,
    sessionId: string,
    limit?: number
  ): Promise<AgentChatMessage[]>;
  upsertAgentChatMessage(
    message: Omit<AgentChatMessage, "createdAt">
  ): Promise<AgentChatMessage>;

  readProjectOps<T = Record<string, unknown>>(): Promise<T>;
  mutateProjectOps<T = Record<string, unknown>>(fn: (data: T) => void | T | Promise<void | T>): Promise<T>;

  clientProgress(clientId: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    progress: number;
  }>;
}

class LocalStore implements DataStore {
  protected cache: StoreData | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  protected async read(): Promise<StoreData> {
    if (this.cache) return this.cache;
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const raw = await fs.readFile(DATA_FILE, "utf8");
      this.cache = { ...emptyStore(), ...(JSON.parse(raw) as Partial<StoreData>) };
    } catch {
      this.cache = emptyStore();
    }
    await ensureSeed(
      this.cache,
      process.env.ALLOW_LOCAL_STORE === "1" && process.env.NODE_ENV !== "production"
    );
    await this.persist(this.cache);
    return this.cache;
  }

  protected async persist(data: StoreData) {
    this.cache = data;
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
    });
    await this.writeChain;
    await bumpRedisCacheVersion();
  }

  protected async mutate<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
    const data = await this.read();
    const result = await fn(data);
    await this.persist(data);
    return result;
  }

  async getUser(uid: string) {
    return (await this.read()).users.find((u) => u.uid === uid) || null;
  }

  async getUserByEmail(email: string) {
    return (
      (await this.read()).users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null
    );
  }

  async getUserByInviteToken(token: string) {
    const user = (await this.read()).users.find((u) => u.inviteToken === token) || null;
    if (!user?.inviteTokenExpiresAt) return user;
    if (new Date(user.inviteTokenExpiresAt).getTime() < Date.now()) return null;
    return user;
  }

  async listUsers() {
    return (await this.read()).users;
  }

  async upsertUser(user: AppUser) {
    return this.mutate((data) => {
      const idx = data.users.findIndex((u) => u.uid === user.uid);
      if (idx >= 0) data.users[idx] = user;
      else data.users.push(user);
      return user;
    });
  }

  async deleteUser(uid: string) {
    await this.mutate((data) => {
      data.users = data.users.filter((u) => u.uid !== uid);
      data.notifications = data.notifications.filter((n) => n.userId !== uid);
    });
  }

  async listClients(filter?: {
    status?: ClientStatus;
    assignedTeamMemberId?: string;
    q?: string;
    tag?: string;
    pipelineStage?: PipelineStage;
  }) {
    let clients = (await this.read()).clients;
    if (filter?.status) clients = clients.filter((c) => c.status === filter.status);
    if (filter?.pipelineStage) {
      clients = clients.filter((c) => c.pipelineStage === filter.pipelineStage);
    }
    if (filter?.assignedTeamMemberId) {
      clients = clients.filter((c) => c.assignedTeamMemberId === filter.assignedTeamMemberId);
    }
    if (filter?.tag) {
      const tag = filter.tag.toLowerCase();
      clients = clients.filter((c) => c.tags.some((t) => t.toLowerCase() === tag));
    }
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      clients = clients.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.companyName.toLowerCase().includes(q) ||
          c.primaryContactEmail.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return clients.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getClient(id: string) {
    return (await this.read()).clients.find((c) => c.id === id) || null;
  }

  async createClient(
    input: Omit<
      Client,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "status"
      | "tags"
      | "customFields"
      | "driveFolderId"
      | "driveFolderUrl"
      | "pipelineStage"
      | "pauseReason"
      | "pausedAt"
    > & {
      status?: ClientStatus;
      pipelineStage?: PipelineStage;
      templateId?: string | null;
      tags?: string[];
      customFields?: Record<string, string>;
      pauseReason?: string | null;
      pausedAt?: string | null;
    }
  ) {
    return this.mutate((data) => {
      const client: Client = {
        id: randomUUID(),
        name: input.name,
        companyName: input.companyName,
        primaryContactEmail: input.primaryContactEmail,
        status: input.status || "not_started",
        pipelineStage: input.pipelineStage || "intake",
        assignedTeamMemberId: input.assignedTeamMemberId,
        templateId: input.templateId ?? "seed_standard",
        tags: input.tags || [],
        customFields: input.customFields || {},
        driveFolderId: null,
        driveFolderUrl: null,
        pauseReason: input.pauseReason ?? null,
        pausedAt: input.pausedAt ?? null,
        createdAt: now(),
        updatedAt: now(),
      };
      data.clients.push(client);
      return client;
    });
  }

  async updateClient(id: string, patch: Partial<Client>) {
    return this.mutate((data) => {
      const idx = data.clients.findIndex((c) => c.id === id);
      if (idx < 0) throw new Error("Client not found");
      data.clients[idx] = { ...data.clients[idx]!, ...patch, id, updatedAt: now() };
      return data.clients[idx]!;
    });
  }

  async bulkUpdateClients(
    ids: string[],
    patch: Partial<Pick<Client, "status" | "assignedTeamMemberId" | "tags" | "pipelineStage">>
  ) {
    return this.mutate((data) => {
      const updated: Client[] = [];
      for (const id of ids) {
        const idx = data.clients.findIndex((c) => c.id === id);
        if (idx < 0) continue;
        const next = { ...data.clients[idx]!, ...patch, id, updatedAt: now() };
        if (patch.tags) next.tags = patch.tags;
        data.clients[idx] = next;
        updated.push(next);
      }
      return updated;
    });
  }

  async deleteClientCascade(id: string) {
    await this.mutate((data) => {
      data.clients = data.clients.filter((c) => c.id !== id);
      data.tasks = data.tasks.filter((t) => t.clientId !== id);
      data.documents = data.documents.filter((d) => d.clientId !== id);
      data.forms = data.forms.filter((f) => f.clientId !== id);
      data.activity = data.activity.filter((a) => a.clientId !== id);
      data.taskComments = data.taskComments.filter((c) => c.clientId !== id);
      data.messages = data.messages.filter((m) => m.clientId !== id);
      data.vessels = data.vessels.filter((v) => v.clientId !== id);
      data.notifications = data.notifications.filter((n) => n.clientId !== id);
      data.users = data.users.map((u) =>
        u.clientId === id ? { ...u, clientId: null, role: u.role === "client" ? u.role : u.role } : u
      );
      data.users = data.users.filter((u) => !(u.role === "client" && u.clientId === null && u.email));
      // remove client portal users for this client
      data.users = data.users.filter((u) => !(u.role === "client" && !data.clients.some((c) => c.id === u.clientId)));
    });
  }

  async listTemplates() {
    return (await this.read()).templates;
  }

  async getTemplate(id: string) {
    return (await this.read()).templates.find((t) => t.id === id) || null;
  }

  async upsertTemplate(template: OnboardingTemplate) {
    return this.mutate((data) => {
      const idx = data.templates.findIndex((t) => t.id === template.id);
      if (idx >= 0) data.templates[idx] = template;
      else data.templates.push(template);
      return template;
    });
  }

  async deleteTemplate(id: string) {
    await this.mutate((data) => {
      data.templates = data.templates.filter((t) => t.id !== id);
    });
  }

  async listTasks(clientId: string) {
    return (await this.read()).tasks
      .filter((t) => t.clientId === clientId)
      .sort((a, b) => a.order - b.order);
  }

  async listAllTasks() {
    return [...(await this.read()).tasks].sort((a, b) => {
      const da = a.dueDate || "9999";
      const db = b.dueDate || "9999";
      return da.localeCompare(db);
    });
  }

  async getTask(id: string) {
    return (await this.read()).tasks.find((t) => t.id === id) || null;
  }

  async createTask(
    input: Omit<
      Task,
      | "id"
      | "createdAt"
      | "completedAt"
      | "internalNotes"
      | "section"
      | "subtasks"
      | "dependsOnTaskIds"
      | "reminderSentAt"
      | "priority"
      | "watcherIds"
      | "escalatedAt"
    > & {
      internalNotes?: string;
      section?: string;
      subtasks?: TaskSubtask[];
      dependsOnTaskIds?: string[];
      reminderSentAt?: string | null;
      priority?: TaskPriority;
      watcherIds?: string[];
      escalatedAt?: string | null;
    }
  ) {
    return this.mutate((data) => {
      const task: Task = {
        ...input,
        id: randomUUID(),
        priority: input.priority || "medium",
        section:
          input.section?.trim() ||
          (input.type === "client_facing" ? "Client tasks" : "Internal tasks"),
        internalNotes: input.internalNotes || "",
        subtasks: input.subtasks || [],
        dependsOnTaskIds: input.dependsOnTaskIds || [],
        watcherIds: input.watcherIds || [],
        reminderSentAt: input.reminderSentAt ?? null,
        escalatedAt: input.escalatedAt ?? null,
        createdAt: now(),
        completedAt: input.status === "completed" ? now() : null,
      };
      data.tasks.push(task);
      return task;
    });
  }

  async updateTask(id: string, patch: Partial<Task>) {
    return this.mutate((data) => {
      const idx = data.tasks.findIndex((t) => t.id === id);
      if (idx < 0) throw new Error("Task not found");
      const next = { ...data.tasks[idx]!, ...patch, id };
      if (patch.status === "completed" && !next.completedAt) next.completedAt = now();
      if (patch.status && patch.status !== "completed") next.completedAt = null;
      data.tasks[idx] = next;
      return next;
    });
  }

  async deleteTask(id: string) {
    await this.mutate((data) => {
      data.tasks = data.tasks.filter((t) => t.id !== id);
      data.taskComments = data.taskComments.filter((c) => c.taskId !== id);
    });
  }

  async generateTasksFromTemplate(
    clientId: string,
    templateId: string,
    assignedTeamMemberId: string | null
  ) {
    const template = await this.getTemplate(templateId);
    if (!template) throw new Error("Template not found");
    const created: Task[] = [];
    const byOrder = new Map<number, string>();
    const base = Date.now();
    for (const item of template.taskList) {
      let dueDate: string | null = null;
      if (item.dueDays != null && item.dueDays >= 0) {
        dueDate = new Date(base + item.dueDays * 24 * 60 * 60 * 1000).toISOString();
      }
      const dependsOnTaskIds = (item.dependsOnOrders || [])
        .map((o) => byOrder.get(o))
        .filter((id): id is string => Boolean(id));
      const task = await this.createTask({
        clientId,
        title: item.title,
        description: item.description || "",
        type: item.type,
        assignedTo: item.assignedRole === "client" ? null : assignedTeamMemberId,
        assignedRole: item.assignedRole,
        status: "pending",
        priority: item.priority || "medium",
        dueDate,
        order: item.order,
        section: item.section || (item.type === "client_facing" ? "Client tasks" : "Internal tasks"),
        formTemplateId: item.formTemplateId || null,
        requiresUpload: Boolean(item.requiresUpload),
        dependsOnTaskIds,
      });
      byOrder.set(item.order, task.id);
      created.push(task);
      if (item.formTemplateId) {
        await this.createForm({
          clientId,
          formTemplateId: item.formTemplateId,
          taskId: task.id,
        });
      }
    }
    return created;
  }

  async listDocuments(clientId: string) {
    return (await this.read()).documents
      .filter((d) => d.clientId === clientId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async listAllDocuments() {
    return [...(await this.read()).documents].sort((a, b) =>
      b.uploadedAt.localeCompare(a.uploadedAt)
    );
  }

  async getDocument(id: string) {
    return (await this.read()).documents.find((d) => d.id === id) || null;
  }

  async createDocument(
    doc: Omit<
      DocumentRecord,
      | "id"
      | "uploadedAt"
      | "status"
      | "reviewNote"
      | "versions"
      | "documentType"
      | "expiresAt"
      | "expiryAlertSentAt"
    > & {
      status?: DocumentRecord["status"];
      reviewNote?: string;
      documentType?: string | null;
      expiresAt?: string | null;
      expiryAlertSentAt?: string | null;
      versions?: DocumentRecord["versions"];
    }
  ) {
    return this.mutate((data) => {
      const uploadedAt = now();
      const record: DocumentRecord = {
        ...doc,
        id: randomUUID(),
        status: doc.status || "pending_review",
        reviewNote: doc.reviewNote || "",
        uploadedAt,
        documentType: doc.documentType ?? null,
        expiresAt: doc.expiresAt ?? null,
        expiryAlertSentAt: doc.expiryAlertSentAt ?? null,
        versions:
          doc.versions ||
          [
            {
              storagePath: doc.storagePath,
              fileName: doc.fileName,
              uploadedAt,
              uploadedBy: doc.uploadedBy,
              contentType: doc.contentType,
              size: doc.size,
            },
          ],
        contentBase64: doc.contentBase64 ?? null,
      };
      data.documents.push(record);
      return record;
    });
  }

  async updateDocument(id: string, patch: Partial<DocumentRecord>) {
    return this.mutate((data) => {
      const idx = data.documents.findIndex((d) => d.id === id);
      if (idx < 0) throw new Error("Document not found");
      data.documents[idx] = { ...data.documents[idx]!, ...patch, id };
      return data.documents[idx]!;
    });
  }

  async listFormTemplates() {
    return (await this.read()).formTemplates;
  }

  async getFormTemplate(id: string) {
    return (await this.read()).formTemplates.find((f) => f.id === id) || null;
  }

  async upsertFormTemplate(template: FormTemplate) {
    return this.mutate((data) => {
      const idx = data.formTemplates.findIndex((f) => f.id === template.id);
      if (idx >= 0) data.formTemplates[idx] = template;
      else data.formTemplates.push(template);
      return template;
    });
  }

  async deleteFormTemplate(id: string) {
    await this.mutate((data) => {
      data.formTemplates = data.formTemplates.filter((f) => f.id !== id);
    });
  }

  async listForms(clientId: string) {
    return (await this.read()).forms.filter((f) => f.clientId === clientId);
  }

  async listAllForms() {
    return (await this.read()).forms;
  }

  async getForm(id: string) {
    return (await this.read()).forms.find((f) => f.id === id) || null;
  }

  async createForm(
    form: Omit<
      FormSubmission,
      "id" | "submittedAt" | "reviewedAt" | "reviewNote" | "status" | "responses" | "riskScore"
    > & {
      responses?: FormSubmission["responses"];
      status?: FormSubmission["status"];
      riskScore?: number | null;
    }
  ) {
    return this.mutate((data) => {
      const record: FormSubmission = {
        id: randomUUID(),
        clientId: form.clientId,
        formTemplateId: form.formTemplateId,
        taskId: form.taskId,
        responses: form.responses || {},
        status: form.status || "not_started",
        riskScore: form.riskScore ?? null,
        submittedAt: null,
        reviewedAt: null,
        reviewNote: "",
      };
      data.forms.push(record);
      return record;
    });
  }

  async updateForm(id: string, patch: Partial<FormSubmission>) {
    return this.mutate((data) => {
      const idx = data.forms.findIndex((f) => f.id === id);
      if (idx < 0) throw new Error("Form not found");
      data.forms[idx] = { ...data.forms[idx]!, ...patch, id };
      return data.forms[idx]!;
    });
  }

  async listActivity(clientId: string) {
    return (await this.read()).activity
      .filter((a) => a.clientId === clientId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async listAllActivity() {
    return [...(await this.read()).activity].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }

  async addActivity(entry: Omit<ActivityLog, "id" | "timestamp"> & { timestamp?: string }) {
    return this.mutate((data) => {
      const record: ActivityLog = {
        id: randomUUID(),
        clientId: entry.clientId,
        actorId: entry.actorId,
        actorName: entry.actorName,
        action: entry.action,
        timestamp: entry.timestamp || now(),
        meta: entry.meta || {},
      };
      data.activity.push(record);
      return record;
    });
  }

  async listTaskComments(taskId: string) {
    return (await this.read()).taskComments
      .filter((c) => c.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addTaskComment(input: Omit<TaskComment, "id" | "createdAt">) {
    return this.mutate((data) => {
      const record: TaskComment = {
        ...input,
        mentionUserIds: input.mentionUserIds || [],
        id: randomUUID(),
        createdAt: now(),
      };
      data.taskComments.push(record);
      return record;
    });
  }

  async listNotifications(userId: string) {
    return (await this.read()).notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createNotification(
    input: Omit<AppNotification, "id" | "createdAt" | "readAt"> & { readAt?: string | null }
  ) {
    return this.mutate((data) => {
      const record: AppNotification = {
        id: randomUUID(),
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href,
        clientId: input.clientId,
        readAt: input.readAt ?? null,
        createdAt: now(),
      };
      data.notifications.push(record);
      return record;
    });
  }

  async markNotificationRead(id: string, userId: string) {
    return this.mutate((data) => {
      const idx = data.notifications.findIndex((n) => n.id === id && n.userId === userId);
      if (idx < 0) throw new Error("Notification not found");
      data.notifications[idx] = {
        ...data.notifications[idx]!,
        readAt: data.notifications[idx]!.readAt || now(),
      };
      return data.notifications[idx]!;
    });
  }

  async markAllNotificationsRead(userId: string) {
    return this.mutate((data) => {
      let count = 0;
      const ts = now();
      for (const n of data.notifications) {
        if (n.userId === userId && !n.readAt) {
          n.readAt = ts;
          count += 1;
        }
      }
      return count;
    });
  }

  async listMessages(clientId: string) {
    return (await this.read()).messages
      .filter((m) => m.clientId === clientId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addMessage(input: Omit<PortalMessage, "id" | "createdAt">) {
    return this.mutate((data) => {
      const record: PortalMessage = {
        ...input,
        id: randomUUID(),
        createdAt: now(),
      };
      data.messages.push(record);
      return record;
    });
  }

  async listVessels(clientId: string) {
    return (await this.read()).vessels
      .filter((v) => v.clientId === clientId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getVessel(id: string) {
    return (await this.read()).vessels.find((v) => v.id === id) || null;
  }

  async upsertVessel(vessel: Vessel) {
    return this.mutate((data) => {
      const idx = data.vessels.findIndex((v) => v.id === vessel.id);
      if (idx >= 0) data.vessels[idx] = vessel;
      else data.vessels.push(vessel);
      return vessel;
    });
  }

  async deleteVessel(id: string) {
    await this.mutate((data) => {
      data.vessels = data.vessels.filter((v) => v.id !== id);
    });
  }

  async listWebhooks() {
    return (await this.read()).webhooks;
  }

  async getWebhook(id: string) {
    return (await this.read()).webhooks.find((w) => w.id === id) || null;
  }

  async upsertWebhook(hook: WebhookEndpoint) {
    return this.mutate((data) => {
      const idx = data.webhooks.findIndex((w) => w.id === hook.id);
      if (idx >= 0) data.webhooks[idx] = hook;
      else data.webhooks.push(hook);
      return hook;
    });
  }

  async deleteWebhook(id: string) {
    await this.mutate((data) => {
      data.webhooks = data.webhooks.filter((w) => w.id !== id);
    });
  }

  async listWebhookDeliveries(webhookId?: string) {
    let rows = (await this.read()).webhookDeliveries;
    if (webhookId) rows = rows.filter((d) => d.webhookId === webhookId);
    return rows.map((delivery) => ({ ...delivery, leaseToken: null })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addWebhookDeliveries(entries: Array<Omit<WebhookDelivery, "id" | "createdAt">>) {
    if (!entries.length) return [];
    return this.mutate((data) => {
      const records = entries.map((entry) => ({ ...entry, id: randomUUID(), createdAt: now() }));
      data.webhookDeliveries.push(...records);
      return records;
    });
  }

  async claimWebhookDeliveries(limit: number) {
    return this.mutate((data) => {
      const nowMs = Date.now();
      const claimed = data.webhookDeliveries.filter((delivery) =>
        (delivery.state === "pending" && Date.parse(delivery.nextAttemptAt || delivery.createdAt) <= nowMs) ||
        (delivery.state === "leased" && Date.parse(delivery.leaseUntil || "") <= nowMs)
      ).slice(0, limit);
      for (const delivery of claimed) {
        delivery.state = "leased";
        delivery.attempts = (delivery.attempts || 0) + 1;
        delivery.leaseToken = randomUUID();
        delivery.leaseUntil = new Date(nowMs + 30_000).toISOString();
      }
      return claimed.map((delivery) => ({ ...delivery }));
    });
  }

  async finishWebhookDeliveries(results: Array<{ id: string; leaseToken: string; statusCode: number | null; error: string | null }>) {
    if (!results.length) return;
    await this.mutate((data) => {
      for (const result of results) {
        const delivery = data.webhookDeliveries.find((item) => item.id === result.id);
        if (!delivery || delivery.state !== "leased" || delivery.leaseToken !== result.leaseToken) continue;
        delivery.statusCode = result.statusCode;
        delivery.success = result.error === null;
        delivery.error = result.error;
        const retry = webhookRetry(delivery.attempts || 1);
        delivery.state = delivery.success ? "succeeded" : retry.state;
        delivery.nextAttemptAt = retry.nextAttemptAt;
        delivery.leaseToken = null;
        delivery.leaseUntil = null;
      }
    });
  }

  async addIntegrationRun(entry: Omit<IntegrationRun, "id" | "createdAt">) {
    return this.mutate((data) => {
      const record: IntegrationRun = {
        ...entry,
        id: randomUUID(),
        createdAt: now(),
      };
      data.integrationRuns.push(record);
      return record;
    });
  }

  async listIntegrationRuns(limit = 50) {
    return [...(await this.read()).integrationRuns]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listSmartLists(ownerId: string) {
    return (await this.read()).smartLists.filter((s) => s.ownerId === ownerId);
  }

  async upsertSmartList(list: SavedSmartList) {
    return this.mutate((data) => {
      const idx = data.smartLists.findIndex((s) => s.id === list.id);
      if (idx >= 0) data.smartLists[idx] = list;
      else data.smartLists.push(list);
      return list;
    });
  }

  async deleteSmartList(id: string) {
    await this.mutate((data) => {
      data.smartLists = data.smartLists.filter((s) => s.id !== id);
    });
  }

  async listClientMessageSummaries(): Promise<MessageClientSummary[]> {
    const data = await this.read();
    const totals = new Map<string, { totalTasks: number; completedTasks: number }>();
    for (const task of data.tasks) {
      const count = totals.get(task.clientId) ?? { totalTasks: 0, completedTasks: 0 };
      count.totalTasks += 1;
      if (task.status === "completed") count.completedTasks += 1;
      totals.set(task.clientId, count);
    }
    const names = new Map(data.users.map((user) => [user.uid, user.name]));
    return [...data.clients]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((client) => {
        const count = totals.get(client.id) ?? { totalTasks: 0, completedTasks: 0 };
        return {
          id: client.id,
          name: client.name,
          companyName: client.companyName,
          status: client.status,
          pipelineStage: client.pipelineStage,
          tags: client.tags,
          ...count,
          progress: calcProgress(count.completedTasks, count.totalTasks),
          assignedTeamMemberName: client.assignedTeamMemberId
            ? names.get(client.assignedTeamMemberId) ?? null
            : null,
        };
      });
  }

  async listAgentChatSessions(userId: string) {
    return (await this.read()).agentChatSessions
      .filter((session) => session.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getAgentChatSession(id: string, userId: string) {
    return (
      (await this.read()).agentChatSessions.find(
        (session) => session.id === id && session.userId === userId
      ) || null
    );
  }

  async createAgentChatSession(userId: string, title = "New chat") {
    return this.mutate((data) => {
      const timestamp = now();
      const session: AgentChatSession = {
        id: randomUUID(),
        userId,
        title: title.trim().slice(0, 80) || "New chat",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      data.agentChatSessions.push(session);
      return session;
    });
  }

  async deleteAgentChatSession(id: string, userId: string) {
    await this.mutate((data) => {
      data.agentChatSessions = data.agentChatSessions.filter(
        (session) => session.id !== id || session.userId !== userId
      );
      data.agentChatMessages = data.agentChatMessages.filter(
        (message) => message.sessionId !== id || message.userId !== userId
      );
    });
  }

  async listAgentChatMessages(userId: string, sessionId: string, limit = 40) {
    return (await this.read()).agentChatMessages
      .filter((message) => message.userId === userId && message.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  }

  async upsertAgentChatMessage(message: Omit<AgentChatMessage, "createdAt">) {
    return this.mutate((data) => {
      const messageId = message.id?.trim() || randomUUID();
      const index = data.agentChatMessages.findIndex(
        (item) => item.userId === message.userId && item.id === messageId
      );
      const record: AgentChatMessage = {
        ...message,
        id: messageId,
        createdAt: index >= 0 ? data.agentChatMessages[index]!.createdAt : now(),
      };
      if (index >= 0) data.agentChatMessages[index] = record;
      else data.agentChatMessages.push(record);
      const session = data.agentChatSessions.find(
        (item) => item.id === message.sessionId && item.userId === message.userId
      );
      if (session) {
        session.updatedAt = now();
        if (session.title === "New chat" && message.role === "user") {
          session.title = message.text.slice(0, 80);
        }
      }
      return record;
    });
  }

  async readProjectOps<T = Record<string, unknown>>() {
    return (await this.read()).projectOps as T;
  }

  async mutateProjectOps<T = Record<string, unknown>>(fn: (data: T) => void | T | Promise<void | T>) {
    return this.mutate(async (data) => {
      const current = data.projectOps as T;
      const result = await fn(current);
      data.projectOps = current as unknown as Record<string, unknown>;
      return (result === undefined ? current : result) as T;
    });
  }

  async clientProgress(clientId: string) {
    const tasks = await this.listTasks(clientId);
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    return { totalTasks, completedTasks, progress: calcProgress(completedTasks, totalTasks) };
  }
}

class PrismaStore extends LocalStore {
  private async upsertRelationalUser(user: AppUser) {
    const data = userProfileData(user);
    await getPrisma().userProfile.upsert({
      where: { uid: user.uid },
      create: data,
      update: data,
    });
  }

  private async syncLegacySnapshot(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      // The relational write is authoritative for these normalized slices.
      // Keeping snapshot sync best-effort preserves rollback compatibility
      // without turning a successful hot-table write into a failed request.
      console.error("Legacy StoreSnapshot sync failed", error);
    }
  }

  override async getUser(uid: string) {
    try {
      const prisma = getPrisma();
      const user = await prisma.userProfile.findUnique({ where: { uid } });
      if (user) return appUserFromProfile(user);

      // Handles a freshly-created/local database whose seed snapshot predates
      // the relational migration. Once any relational user exists, a missing
      // row is authoritative and must never be resurrected from stale JSON.
      if ((await prisma.userProfile.count()) > 0) return null;
      const legacy = await super.getUser(uid);
      if (legacy) await this.upsertRelationalUser(legacy);
      return legacy;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.getUser(uid);
      throw error;
    }
  }

  override async getUserByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const prisma = getPrisma();
      const user = await prisma.userProfile.findFirst({
        where: { email: normalizedEmail },
      });
      if (user) return appUserFromProfile(user);

      if ((await prisma.userProfile.count()) > 0) return null;
      const legacy = await super.getUserByEmail(normalizedEmail);
      if (legacy) await this.upsertRelationalUser(legacy);
      return legacy;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.getUserByEmail(normalizedEmail);
      throw error;
    }
  }

  override async getUserByInviteToken(token: string) {
    try {
      const prisma = getPrisma();
      const user = await prisma.userProfile.findFirst({ where: { inviteToken: token } });
      if (user) {
        if (user.inviteTokenExpiresAt && user.inviteTokenExpiresAt.getTime() < Date.now()) {
          return null;
        }
        return appUserFromProfile(user);
      }

      if ((await prisma.userProfile.count()) > 0) return null;
      const legacy = await super.getUserByInviteToken(token);
      if (legacy) await this.upsertRelationalUser(legacy);
      return legacy;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.getUserByInviteToken(token);
      throw error;
    }
  }

  override async listUsers() {
    try {
      const users = await getPrisma().userProfile.findMany({ orderBy: { name: "asc" } });
      if (users.length > 0) return users.map(appUserFromProfile);

      const legacy = await super.listUsers();
      await Promise.all(legacy.map((user) => this.upsertRelationalUser(user)));
      return legacy;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.listUsers();
      throw error;
    }
  }

  override async upsertUser(user: AppUser) {
    try {
      await this.upsertRelationalUser(user);
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.upsertUser(user);
      throw error;
    }

    await this.syncLegacySnapshot(() => super.upsertUser(user));
    return user;
  }

  override async deleteUser(uid: string) {
    try {
      const prisma = getPrisma();
      await prisma.$executeRaw`WITH notifications AS (DELETE FROM "NotificationRecord" WHERE "userId" = ${uid}) DELETE FROM "UserProfile" WHERE "uid" = ${uid}`;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.deleteUser(uid);
      throw error;
    }

    await this.syncLegacySnapshot(() => super.deleteUser(uid));
  }

  override async listNotifications(userId: string) {
    try {
      const notifications = await getPrisma().notificationRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return notifications.map(appNotificationFromRecord);
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.listNotifications(userId);
      throw error;
    }
  }

  override async createNotification(
    input: Omit<AppNotification, "id" | "createdAt" | "readAt"> & { readAt?: string | null }
  ) {
    const record: AppNotification = {
      ...input,
      id: randomUUID(),
      readAt: input.readAt ?? null,
      createdAt: now(),
    };

    try {
      await getPrisma().notificationRecord.create({
        data: {
          ...record,
          createdAt: new Date(record.createdAt),
          readAt: record.readAt ? new Date(record.readAt) : null,
        },
      });
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.createNotification(input);
      throw error;
    }

    await this.syncLegacySnapshot(() =>
      this.mutate((data) => {
        data.notifications.push(record);
        return record;
      })
    );
    return record;
  }

  override async markNotificationRead(id: string, userId: string) {
    try {
      const existing = await getPrisma().notificationRecord.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        const legacy = await super.markNotificationRead(id, userId);
        await getPrisma().notificationRecord.upsert({
          where: { id: legacy.id },
          create: {
            ...legacy,
            createdAt: new Date(legacy.createdAt),
            readAt: legacy.readAt ? new Date(legacy.readAt) : null,
          },
          update: { readAt: legacy.readAt ? new Date(legacy.readAt) : new Date() },
        });
        return legacy;
      }

      const notification = existing.readAt
        ? existing
        : await getPrisma().notificationRecord.update({
            where: { id },
            data: { readAt: new Date() },
          });
      const result = appNotificationFromRecord(notification);
      await this.syncLegacySnapshot(() => super.markNotificationRead(id, userId));
      return result;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.markNotificationRead(id, userId);
      throw error;
    }
  }

  override async markAllNotificationsRead(userId: string) {
    try {
      const count = await getPrisma().$executeRaw`UPDATE "NotificationRecord" SET "readAt" = ${new Date()} WHERE "userId" = ${userId} AND "readAt" IS NULL`;
      await this.syncLegacySnapshot(() => super.markAllNotificationsRead(userId));
      return count;
    } catch (error) {
      if (relationalStoreUnavailable(error)) return super.markAllNotificationsRead(userId);
      throw error;
    }
  }

  override async deleteClientCascade(id: string) {
    await super.deleteClientCascade(id);
    try {
      const prisma = getPrisma();
      await prisma.$executeRaw`WITH notifications AS (DELETE FROM "NotificationRecord" WHERE "clientId" = ${id}) DELETE FROM "UserProfile" WHERE "clientId" = ${id} AND "role" = 'client'`;
    } catch (error) {
      if (!relationalStoreUnavailable(error)) throw error;
    }
  }

  override async readProjectOps<T = Record<string, unknown>>() {
    const snapshot = await getPrisma().storeSnapshot.findUnique({ where: { id: "main" } });
    if (!snapshot) return super.readProjectOps<T>();
    return ((snapshot.data as Partial<StoreData>).projectOps || {}) as T;
  }

  override async mutateProjectOps<T = Record<string, unknown>>(
    fn: (data: T) => void | T | Promise<void | T>
  ) {
    return super.mutateProjectOps(fn);
  }

  protected override async mutate<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
    const prisma = getPrisma();
    // The callback may be replayed after a conflicting write. Only publish its
    // result and cache after the corresponding version has been committed.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let snapshot = await prisma.storeSnapshot.findUnique({ where: { id: "main" } });
      if (!snapshot) {
        // Initialization must never replace a snapshot created by another
        // request while this one was building its initial data.
        const initial = emptyStore();
        await ensureSeed(initial);
        try {
          snapshot = await prisma.storeSnapshot.create({
            data: { id: "main", data: initial as unknown as Prisma.InputJsonValue },
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
            throw error;
          }
          continue;
        }
      }

      const data = { ...emptyStore(), ...(snapshot.data as Partial<StoreData>) };
      await ensureSeed(data);
      const result = await fn(data);
      try {
        // updateOne is a single statement in Neon HTTP mode. updateMany
        // starts a transaction there, which the HTTP adapter cannot run.
        await prisma.storeSnapshot.update({
          where: { id: "main", version: snapshot.version },
          data: {
            data: data as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        this.cache = data;
        await bumpRedisCacheVersion();
        return result;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2025") {
          throw error;
        }
      }

      // A retry reads a fresh record. A small jitter reduces repeat clashes
      // when several Worker isolates are writing the same snapshot.
      await new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 40) + Math.random() * 10));
    }
    throw new Error("Store snapshot changed too often; please retry the request");
  }

  protected override async read(): Promise<StoreData> {
    // A StoreSnapshot contains the complete application store. Re-reading and
    // decoding it for every collection lookup can exceed Cloudflare's CPU
    // limit on pages such as global search and notifications. Reuse the
    // in-memory snapshot for this Worker isolate; persist() refreshes it after
    // every mutation.
    if (this.cache) return this.cache;

    const prisma = getPrisma();
    const snapshot = await prisma.storeSnapshot.findUnique({ where: { id: "main" } });
    if (!snapshot) {
      const data = emptyStore();
      await ensureSeed(data);
      try {
        await prisma.storeSnapshot.create({
          data: { id: "main", data: data as unknown as Prisma.InputJsonValue },
        });
        this.cache = data;
        return data;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        // Another request initialized the row first. Use its committed data.
        const committed = await prisma.storeSnapshot.findUniqueOrThrow({ where: { id: "main" } });
        this.cache = { ...emptyStore(), ...(committed.data as Partial<StoreData>) };
        return this.cache;
      }
    }

    const data = { ...emptyStore(), ...(snapshot.data as Partial<StoreData>) };
    await ensureSeed(data);
    this.cache = data;
    return data;
  }

  protected override async persist(data: StoreData) {
    void data;
    throw new Error("PrismaStore writes must use a versioned mutation");
  }
}

let storePromise: Promise<DataStore> | null = null;

export async function getStore(): Promise<DataStore> {
  if (!storePromise) {
    storePromise = (async () => {
      if (process.env.DATABASE_URL?.trim()) return new PrismaStore();
      if (process.env.ALLOW_LOCAL_STORE === "1") return new LocalStore();
      throw new Error(
        "Neon is not configured. Set DATABASE_URL and DIRECT_URL, or explicitly set ALLOW_LOCAL_STORE=1 for demo-only mode."
      );
    })();
  }
  return storePromise;
}

export type { TaskStatus, NotificationKind };
