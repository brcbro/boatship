import { randomUUID } from "crypto";
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
import { Collection, getFirestore, isFirestoreStatus, isHostedStore, type DocSnapshot, type FirestoreReader, type Where, type Write } from "@/lib/firestore";
import { deleteWhere, updateWhere } from "@/lib/firestore/bulk";
import { deleteDocumentObjects, listClientDocumentObjectKeys } from "@/lib/document-content";
import { ensureLegacyEngagement } from "@/lib/engagements";
import { ensurePrimaryContact } from "@/lib/client-contacts";
import { hashPassword } from "@/lib/password";
import { bumpRedisCacheVersion } from "@/lib/redis-cache";
import { webhookRetry } from "@/lib/webhook-retry";
import { DEFAULT_TEAM_PERMISSIONS } from "@/lib/rbac";
import { getRequestStoreScope } from "@/lib/store-context";
import { forgetUserSessions } from "@/lib/session-cache";
import { accountStatus, currentAuthzVersion, isAccountStatus } from "@/lib/account-status";
import { applyFormSubmission, type FormSubmissionInput } from "@/lib/form-submission";
import { applyDocumentUpload } from "@/lib/document-upload";

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

export type UserProfileDoc = {
  uid: string; email: string; name: string; role: string; clientId: string | null; createdAt: string;
  inviteToken: string | null; inviteTokenExpiresAt: string | null; mustResetPassword: boolean;
  password: string | null; passwordHash: string | null; permissions: string[]; digestEnabled: boolean; lastDigestAt: string | null;
  /** Account foundations (2026-10-23). Absent on older documents; readers derive defaults. */
  status?: string; authzVersion?: number; updatedAt?: string | null; statusChangedAt?: string | null; statusReason?: string | null;
};

/** Fields a partial user update may touch. Identity (`uid`, `createdAt`) is never patched. */
export type UserFieldPatch = Partial<Omit<AppUser, "uid" | "createdAt">>;

type NotificationDoc = {
  id: string; userId: string; kind: string; title: string; body: string; href: string | null; clientId: string | null; readAt: string | null; createdAt: string;
};

/** Full document form of a user, as written by `upsertUser` and the account service. */
export function userProfileData(user: AppUser): UserProfileDoc {
  return {
    uid: user.uid,
    email: user.email.trim().toLowerCase(),
    name: user.name,
    role: user.role,
    clientId: user.clientId ?? null,
    createdAt: new Date(user.createdAt).toISOString(),
    inviteToken: user.inviteToken ?? null,
    inviteTokenExpiresAt: user.inviteTokenExpiresAt ? new Date(user.inviteTokenExpiresAt).toISOString() : null,
    mustResetPassword: user.mustResetPassword ?? false,
    password: user.password ?? null,
    passwordHash: user.passwordHash ?? null,
    permissions: user.permissions ?? (user.role === "team" ? [...DEFAULT_TEAM_PERMISSIONS] : []),
    digestEnabled: user.digestEnabled ?? false,
    lastDigestAt: user.lastDigestAt ? new Date(user.lastDigestAt).toISOString() : null,
    status: accountStatus(user),
    authzVersion: currentAuthzVersion(user),
    updatedAt: user.updatedAt ?? null,
    statusChangedAt: user.statusChangedAt ?? null,
    statusReason: user.statusReason ?? null,
  };
}

/** Partial-document form of a user patch: only the submitted fields, normalised like the full codec. */
export function userProfilePatch(patch: UserFieldPatch): Partial<UserProfileDoc> {
  const doc: Partial<UserProfileDoc> = {};
  if ("email" in patch && patch.email !== undefined) doc.email = patch.email.trim().toLowerCase();
  if ("name" in patch && patch.name !== undefined) doc.name = patch.name;
  if ("role" in patch && patch.role !== undefined) doc.role = patch.role;
  if ("clientId" in patch) doc.clientId = patch.clientId ?? null;
  if ("inviteToken" in patch) doc.inviteToken = patch.inviteToken ?? null;
  if ("inviteTokenExpiresAt" in patch) doc.inviteTokenExpiresAt = patch.inviteTokenExpiresAt ? new Date(patch.inviteTokenExpiresAt).toISOString() : null;
  if ("mustResetPassword" in patch) doc.mustResetPassword = patch.mustResetPassword ?? false;
  if ("password" in patch) doc.password = patch.password ?? null;
  if ("passwordHash" in patch) doc.passwordHash = patch.passwordHash ?? null;
  if ("permissions" in patch && patch.permissions !== undefined) doc.permissions = patch.permissions;
  if ("digestEnabled" in patch) doc.digestEnabled = patch.digestEnabled ?? false;
  if ("lastDigestAt" in patch) doc.lastDigestAt = patch.lastDigestAt ? new Date(patch.lastDigestAt).toISOString() : null;
  if ("status" in patch && patch.status !== undefined) doc.status = patch.status;
  if ("authzVersion" in patch && patch.authzVersion !== undefined) doc.authzVersion = patch.authzVersion;
  if ("statusChangedAt" in patch) doc.statusChangedAt = patch.statusChangedAt ?? null;
  if ("statusReason" in patch) doc.statusReason = patch.statusReason ?? null;
  doc.updatedAt = patch.updatedAt ?? now();
  return doc;
}

export function appUserFromProfile(user: UserProfileDoc): AppUser {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role as AppUser["role"],
    clientId: user.clientId,
    createdAt: user.createdAt,
    inviteToken: user.inviteToken,
    inviteTokenExpiresAt: user.inviteTokenExpiresAt ?? null,
    mustResetPassword: user.mustResetPassword,
    password: user.password,
    passwordHash: user.passwordHash,
    permissions: user.permissions as NonNullable<AppUser["permissions"]>,
    digestEnabled: user.digestEnabled,
    lastDigestAt: user.lastDigestAt ?? null,
    status: isAccountStatus(user.status) ? user.status : undefined,
    authzVersion: Number.isSafeInteger(user.authzVersion) ? user.authzVersion : undefined,
    updatedAt: user.updatedAt ?? null,
    statusChangedAt: user.statusChangedAt ?? null,
    statusReason: user.statusReason ?? null,
  };
}

function notificationData(notification: AppNotification): NotificationDoc {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    href: notification.href ?? null,
    clientId: notification.clientId ?? null,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt,
  };
}

function appNotificationFromRecord(notification: NotificationDoc): AppNotification {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind as NotificationKind,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    clientId: notification.clientId,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt,
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
    engagementId: raw.engagementId,
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
    engagementId: raw.engagementId ?? null,
    contentId: raw.contentId ?? null,
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
    engagementId: raw.engagementId ?? null,
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
  /**
   * Replaces only the named fields. Use this for every change made while
   * other fields may change concurrently (profile saves, digest stamps,
   * permission edits), so a stale whole-user object never overwrites a
   * credential, status or permission written in between. Rejects an unknown uid.
   */
  updateUserFields(uid: string, patch: UserFieldPatch): Promise<AppUser>;
  /** After a transaction wrote the profile document directly: drop memoised sessions and refresh secondary copies. */
  syncUserProfile(uid: string): Promise<AppUser | null>;
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
      id?: string;
    }
  ): Promise<DocumentRecord>;
  updateDocument(id: string, patch: Partial<DocumentRecord>): Promise<DocumentRecord>;
  persistDocumentUpload(document: DocumentRecord, actor: { uid: string; name: string }): Promise<DocumentRecord>;

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
  submitFormOnce(input: FormSubmissionInput): Promise<FormSubmission>;

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

  async updateUserFields(uid: string, patch: UserFieldPatch) {
    return this.mutate((data) => {
      const idx = data.users.findIndex((u) => u.uid === uid);
      if (idx < 0) throw new Error(`User ${uid} does not exist`);
      const next: AppUser = { ...data.users[idx], ...patch, uid, createdAt: data.users[idx].createdAt, updatedAt: patch.updatedAt ?? now() };
      data.users[idx] = next;
      return next;
    });
  }

  async syncUserProfile(uid: string) {
    return this.getUser(uid);
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
        engagementId: input.engagementId || `onboarding_${input.clientId}`,
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
      id?: string;
    }
  ) {
    return this.mutate((data) => {
      const uploadedAt = now();
      const record: DocumentRecord = {
        ...doc,
        id: doc.id || randomUUID(),
        status: doc.status || "pending_review",
        reviewNote: doc.reviewNote || "",
        uploadedAt,
        documentType: doc.documentType ?? null,
        expiresAt: doc.expiresAt ?? null,
        expiryAlertSentAt: doc.expiryAlertSentAt ?? null,
        versions: doc.versions || [],
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

  async persistDocumentUpload(document: DocumentRecord, actor: { uid: string; name: string }) {
    return this.mutate((data) => applyDocumentUpload(data, document, actor));
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
        engagementId: form.engagementId ?? (form.taskId ? data.tasks.find((task) => task.id === form.taskId && task.clientId === form.clientId)?.engagementId || `onboarding_${form.clientId}` : null),
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

  async submitFormOnce(input: FormSubmissionInput) {
    return this.mutate((data) => applyFormSubmission(data, input));
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

/** Firestore layout of the delivery store: one document per slice plus a meta document. */
const SNAPSHOT_COLLECTION = "StoreSnapshot";
const SNAPSHOT_META_ID = "main";
const SNAPSHOT_SLICE_PREFIX = "main:";
const SNAPSHOT_SLICE_LIMIT = 900_000; // bytes of JSON; Firestore caps a document at 1 MiB
const SLICE_KEYS = Object.keys(emptyStore()) as Array<keyof StoreData>;

type SliceDoc = { json: string; version: number };
type MetaDoc = { version: number; updatedAt: string };

export const USER_PROFILES = new Collection<UserProfileDoc>("UserProfile");
const NOTIFICATIONS = new Collection<NotificationDoc>("NotificationRecord");

function sliceId(key: string) {
  return `${SNAPSHOT_SLICE_PREFIX}${key}`;
}

function parseSlices(docs: Map<string, DocSnapshot<SliceDoc>>): StoreData {
  const data = emptyStore();
  for (const key of SLICE_KEYS) {
    const doc = docs.get(sliceId(key));
    if (!doc) continue;
    try { (data as Record<string, unknown>)[key] = JSON.parse(doc.data.json); }
    catch (error) { throw new Error(`Store slice ${key} is corrupt: ${error instanceof Error ? error.message : "unparseable"}`); }
  }
  return data;
}

function serializeSlice(key: keyof StoreData, value: unknown): string {
  const json = JSON.stringify(value ?? (key === "projectOps" ? {} : []));
  if (json.length > SNAPSHOT_SLICE_LIMIT) throw new Error(`Store slice ${key} exceeds the ${SNAPSHOT_SLICE_LIMIT} byte Firestore document limit; archive old records before writing more`);
  return json;
}

type SnapshotSlices = Map<string, DocSnapshot<SliceDoc>>;
type SnapshotCache = { version: number; slices: SnapshotSlices };

/**
 * Per-runtime-instance copy of the slice documents, keyed by the client so
 * tests that swap clients never share state. Only the raw JSON is cached:
 * every request still parses its own copy, so callers may mutate what the
 * store returns exactly as before. A request costs one meta read; the slices
 * are fetched again only when the meta version moved, and then only those
 * written since the cached version.
 */
const snapshotCaches = new WeakMap<object, SnapshotCache>();

function rememberSnapshot(client: object, version: number, slices: SnapshotSlices) {
  const current = snapshotCaches.get(client);
  if (current && current.version >= version) return;
  snapshotCaches.set(client, { version, slices });
}

/** Removes the cached slices for the active client; tests use it between fixtures. */
export function resetSnapshotCache() {
  snapshotCaches.delete(getFirestore());
}

async function loadSlices(reader: FirestoreReader): Promise<{ meta: DocSnapshot<MetaDoc> | null; slices: SnapshotSlices }> {
  const client = getFirestore();
  const meta = await reader.get<MetaDoc>(SNAPSHOT_COLLECTION, SNAPSHOT_META_ID);
  const cached = snapshotCaches.get(client);
  if (meta && cached && cached.version === meta.data.version) return { meta, slices: cached.slices };
  if (meta && cached) {
    const changed = await reader.query<SliceDoc>({ collection: SNAPSHOT_COLLECTION, where: [{ field: "version", op: ">", value: cached.version }] });
    const slices: SnapshotSlices = new Map(cached.slices);
    for (const doc of changed) if (doc.id !== SNAPSHOT_META_ID) slices.set(doc.id, doc);
    rememberSnapshot(client, meta.data.version, slices);
    return { meta, slices };
  }
  const slices = await reader.getMany<SliceDoc>(SNAPSHOT_COLLECTION, SLICE_KEYS.map(sliceId));
  if (meta) rememberSnapshot(client, meta.data.version, slices);
  return { meta, slices };
}

/** Reads one slice without parsing the whole store (authorization hot path). */
export async function readSnapshotSlice<K extends keyof StoreData>(key: K): Promise<StoreData[K]> {
  const { slices } = await loadSlices(getFirestore());
  const doc = slices.get(sliceId(key));
  if (!doc) return emptyStore()[key];
  return JSON.parse(doc.data.json) as StoreData[K];
}

class FirestoreStore extends LocalStore {
  override async createClient(input: Parameters<LocalStore["createClient"]>[0]) {
    const client = await super.createClient(input);
    await Promise.allSettled([ensureLegacyEngagement(client), ensurePrimaryContact(client)]).then((results) => {
      for (const result of results) if (result.status === "rejected") console.error("Client relational sync failed", result.reason);
    });
    return client;
  }

  override async updateClient(id: string, patch: Partial<Client>) {
    const client = await super.updateClient(id, patch);
    await ensureLegacyEngagement(client).catch((error) => console.error("Client engagement sync failed", error));
    return client;
  }

  override async bulkUpdateClients(ids: string[], patch: Partial<Pick<Client, "status" | "assignedTeamMemberId" | "tags" | "pipelineStage">>) {
    const clients = await super.bulkUpdateClients(ids, patch);
    await Promise.allSettled(clients.map(ensureLegacyEngagement)).then((results) => {
      for (const result of results) if (result.status === "rejected") console.error("Client engagement sync failed", result.reason);
    });
    return clients;
  }

  private async upsertProfile(user: AppUser) {
    await USER_PROFILES.set(user.uid, userProfileData(user));
  }

  private async syncLegacySnapshot(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      // The profile/notification collections are authoritative for these
      // slices; the snapshot copy is best-effort for older readers.
      console.error("Legacy snapshot sync failed", error);
    }
  }

  override async getUser(uid: string) {
    const profile = await USER_PROFILES.get(uid);
    if (profile) return appUserFromProfile(profile);
    // A fresh database whose seed snapshot predates the profile collection.
    // Once any profile exists, a missing document is authoritative.
    if ((await USER_PROFILES.count()) > 0) return null;
    const legacy = await super.getUser(uid);
    if (legacy) await this.upsertProfile(legacy);
    return legacy;
  }

  override async getUserByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const profile = await USER_PROFILES.findFirst([{ field: "email", op: "==", value: normalizedEmail }]);
    if (profile) return appUserFromProfile(profile);
    if ((await USER_PROFILES.count()) > 0) return null;
    const legacy = await super.getUserByEmail(normalizedEmail);
    if (legacy) await this.upsertProfile(legacy);
    return legacy;
  }

  override async getUserByInviteToken(token: string) {
    const profile = await USER_PROFILES.findFirst([{ field: "inviteToken", op: "==", value: token }]);
    if (profile) {
      if (profile.inviteTokenExpiresAt && new Date(profile.inviteTokenExpiresAt).getTime() < Date.now()) return null;
      return appUserFromProfile(profile);
    }
    if ((await USER_PROFILES.count()) > 0) return null;
    const legacy = await super.getUserByInviteToken(token);
    if (legacy) await this.upsertProfile(legacy);
    return legacy;
  }

  override async listUsers() {
    const profiles = await USER_PROFILES.find([], { orderBy: [{ field: "name" }] });
    if (profiles.length > 0) return profiles.map(appUserFromProfile);
    const legacy = await super.listUsers();
    await Promise.all(legacy.map((user) => this.upsertProfile(user)));
    return legacy;
  }

  override async upsertUser(user: AppUser) {
    forgetUserSessions(user.uid);
    await this.upsertProfile(user);
    await this.syncLegacySnapshot(() => super.upsertUser(user));
    return user;
  }

  override async updateUserFields(uid: string, patch: UserFieldPatch) {
    forgetUserSessions(uid);
    // A partial document update: concurrent writers of other fields are never
    // overwritten, and the storage client rejects a missing document.
    await USER_PROFILES.update(uid, userProfilePatch(patch));
    const profile = await USER_PROFILES.get(uid);
    if (!profile) throw new Error(`User ${uid} does not exist`);
    const user = appUserFromProfile(profile);
    await this.syncLegacySnapshot(() => super.upsertUser(user));
    return user;
  }

  override async syncUserProfile(uid: string) {
    forgetUserSessions(uid);
    const profile = await USER_PROFILES.get(uid);
    if (!profile) return null;
    const user = appUserFromProfile(profile);
    await this.syncLegacySnapshot(() => super.upsertUser(user));
    return user;
  }

  override async deleteUser(uid: string) {
    forgetUserSessions(uid);
    await deleteWhere(NOTIFICATIONS.name, [{ field: "userId", op: "==", value: uid }]);
    await USER_PROFILES.delete(uid);
    await this.syncLegacySnapshot(() => super.deleteUser(uid));
  }

  override async listNotifications(userId: string) {
    const records = await NOTIFICATIONS.find([{ field: "userId", op: "==", value: userId }], { orderBy: [{ field: "createdAt", direction: "desc" }] });
    return records.map(appNotificationFromRecord);
  }

  override async createNotification(
    input: Omit<AppNotification, "id" | "createdAt" | "readAt"> & { readAt?: string | null }
  ) {
    const record: AppNotification = { ...input, id: randomUUID(), readAt: input.readAt ?? null, createdAt: now() };
    await NOTIFICATIONS.create(record.id, notificationData(record));
    await this.syncLegacySnapshot(() => this.mutate((data) => { data.notifications.push(record); return record; }));
    return record;
  }

  override async markNotificationRead(id: string, userId: string) {
    const existing = await NOTIFICATIONS.get(id);
    if (!existing || existing.userId !== userId) {
      const legacy = await super.markNotificationRead(id, userId);
      await NOTIFICATIONS.set(legacy.id, notificationData({ ...legacy, readAt: legacy.readAt ?? now() }));
      return legacy;
    }
    const readAt = existing.readAt ?? now();
    if (!existing.readAt) await NOTIFICATIONS.update(id, { readAt });
    const result = appNotificationFromRecord({ ...existing, readAt });
    await this.syncLegacySnapshot(() => super.markNotificationRead(id, userId));
    return result;
  }

  override async markAllNotificationsRead(userId: string) {
    const count = await updateWhere(NOTIFICATIONS.name, [{ field: "userId", op: "==", value: userId }, { field: "readAt", op: "is-null" }], { readAt: now() });
    await this.syncLegacySnapshot(() => super.markAllNotificationsRead(userId));
    return count;
  }

  override async deleteClientCascade(id: string) {
    await super.deleteClientCascade(id);
    const objectKeys = await listClientDocumentObjectKeys(id);
    const byClient: Where[] = [{ field: "clientId", op: "==", value: id }];
    for (const collection of ["NotificationRecord", "Engagement", "ClientContact", "DocumentContent", "IntegrationJob"]) await deleteWhere(collection, byClient);
    await deleteWhere(USER_PROFILES.name, [...byClient, { field: "role", op: "==", value: "client" }]);
    await deleteDocumentObjects(objectKeys);
  }

  override async readProjectOps<T = Record<string, unknown>>() {
    return (await readSnapshotSlice("projectOps")) as T;
  }

  override async mutateProjectOps<T = Record<string, unknown>>(
    fn: (data: T) => void | T | Promise<void | T>
  ) {
    return super.mutateProjectOps(fn);
  }

  private async loadSnapshot(reader: FirestoreReader): Promise<{ data: StoreData; meta: DocSnapshot<MetaDoc> | null; slices: SnapshotSlices }> {
    const { meta, slices } = await loadSlices(reader);
    return { data: parseSlices(slices), meta, slices };
  }

  private sliceWrites(before: Map<string, DocSnapshot<SliceDoc>>, data: StoreData, version: number): Write[] {
    const writes: Write[] = [];
    for (const key of SLICE_KEYS) {
      const json = serializeSlice(key, data[key]);
      if (before.get(sliceId(key))?.data.json === json) continue;
      writes.push({ set: { collection: SNAPSHOT_COLLECTION, id: sliceId(key), data: { json, version } } });
    }
    return writes;
  }

  protected override async mutate<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
    // Firestore transactions re-run the callback on contention, so its result
    // is only published once the corresponding version has committed.
    const committed = await getFirestore().runTransaction(async (tx) => {
      const { data, meta, slices } = await this.loadSnapshot(tx);
      await ensureSeed(data);
      const result = await fn(data);
      const version = (meta?.data.version ?? 0) + 1;
      const writes = this.sliceWrites(slices, data, version);
      for (const write of writes) tx.write(write);
      tx.write({ set: { collection: SNAPSHOT_COLLECTION, id: SNAPSHOT_META_ID, data: { version, updatedAt: now() } } });
      return { result, data, version, writes, slices };
    }, { attempts: 12 });
    // The committed slices are the newest state this instance knows, so the
    // next request skips the slice reads unless another writer moved on.
    const next: SnapshotSlices = new Map(committed.slices);
    for (const write of committed.writes) if ("set" in write) next.set(write.set.id, { id: write.set.id, data: write.set.data as SliceDoc, updateTime: "" });
    rememberSnapshot(getFirestore(), committed.version, next);
    this.cache = committed.data;
    await bumpRedisCacheVersion();
    return committed.result;
  }

  protected override async read(): Promise<StoreData> {
    // This store is scoped to one API request. Collection lookups reuse its
    // snapshot, while later requests always read the latest committed state.
    if (this.cache) return this.cache;
    const { data, meta } = await this.loadSnapshot(getFirestore());
    await ensureSeed(data);
    if (!meta) {
      // First run: persist the seeded store unless another request did first.
      try {
        const writes = this.sliceWrites(new Map(), data, 1);
        writes.push({ set: { collection: SNAPSHOT_COLLECTION, id: SNAPSHOT_META_ID, data: { version: 1, updatedAt: now() }, precondition: { exists: false } } });
        await getFirestore().commit(writes);
      } catch (error) {
        if (!isFirestoreStatus(error, "ALREADY_EXISTS", "FAILED_PRECONDITION")) throw error;
        const committed = await this.loadSnapshot(getFirestore());
        await ensureSeed(committed.data);
        this.cache = committed.data;
        return this.cache;
      }
    }
    this.cache = data;
    return data;
  }

  protected override async persist(data: StoreData) {
    void data;
    throw new Error("FirestoreStore writes must use a versioned mutation");
  }
}

let localStorePromise: Promise<DataStore> | null = null;

export async function getStore(): Promise<DataStore> {
  if (isHostedStore()) {
    const scope = getRequestStoreScope();
    if (!scope) return new FirestoreStore();
    scope.store ??= Promise.resolve(new FirestoreStore());
    return scope.store;
  }
  if (process.env.ALLOW_LOCAL_STORE === "1") {
    localStorePromise ??= Promise.resolve(new LocalStore());
    return localStorePromise;
  }
  throw new Error("Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key), or explicitly set ALLOW_LOCAL_STORE=1 for demo-only mode.");
}

export type { TaskStatus, NotificationKind };
