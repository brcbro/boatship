export type UserRole = "admin" | "team" | "client";

export type StaffPermission =
  | "clients.manage"
  | "clients.view"
  | "documents.review"
  | "forms.review"
  | "templates.manage"
  | "team.manage"
  | "integrations.manage"
  | "analytics.view"
  | "webhooks.manage"
  | "audit.export";

export type ClientStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "on_hold";

export type PipelineStage =
  | "intake"
  | "kyc"
  | "compliance"
  | "kickoff"
  | "go_live"
  | "done";

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export type TaskType = "internal" | "client_facing";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type DocumentStatus = "pending_review" | "approved" | "rejected";

export type FormStatus = "not_started" | "submitted" | "reviewed";

export type AssignedRole = "admin" | "team" | "client";

export type TemplatePublishStatus = "draft" | "published" | "archived";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  clientId: string | null;
  createdAt: string;
  inviteToken?: string | null;
  inviteTokenExpiresAt?: string | null;
  mustResetPassword?: boolean;
  /** Local/demo password (prefer passwordHash when set). */
  password?: string | null;
  /** scrypt hash `salt:hex` for non-demo accounts */
  passwordHash?: string | null;
  permissions?: StaffPermission[];
  digestEnabled?: boolean;
  lastDigestAt?: string | null;
}

export interface Vessel {
  id: string;
  clientId: string;
  name: string;
  imo: string;
  flag: string;
  vesselType: string;
  classSociety: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  companyName: string;
  primaryContactEmail: string;
  status: ClientStatus;
  pipelineStage: PipelineStage;
  assignedTeamMemberId: string | null;
  templateId: string | null;
  tags: string[];
  customFields: Record<string, string>;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateTask {
  title: string;
  description?: string;
  type: TaskType;
  order: number;
  assignedRole: AssignedRole;
  section?: string;
  formTemplateId?: string | null;
  requiresUpload?: boolean;
  dueDays?: number | null;
  priority?: TaskPriority;
  /** Index of dependency tasks within the same template taskList */
  dependsOnOrders?: number[];
}

export interface OnboardingTemplate {
  id: string;
  name: string;
  description?: string;
  taskList: TemplateTask[];
  version: number;
  publishStatus: TemplatePublishStatus;
  /** Previous version id when cloned/published */
  parentTemplateId: string | null;
  industry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  clientId: string;
  title: string;
  description: string;
  type: TaskType;
  assignedTo: string | null;
  assignedRole: AssignedRole;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  order: number;
  section: string;
  internalNotes: string;
  formTemplateId: string | null;
  requiresUpload: boolean;
  subtasks: TaskSubtask[];
  dependsOnTaskIds: string[];
  watcherIds: string[];
  reminderSentAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  clientId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionUserIds: string[];
  createdAt: string;
}

export interface DocumentVersion {
  storagePath: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  contentType: string;
  size: number;
}

export interface DocumentRecord {
  id: string;
  clientId: string;
  taskId: string | null;
  fileName: string;
  storagePath: string;
  uploadedBy: string;
  status: DocumentStatus;
  reviewNote: string;
  uploadedAt: string;
  contentType: string;
  size: number;
  documentType: string | null;
  expiresAt: string | null;
  expiryAlertSentAt: string | null;
  versions: DocumentVersion[];
}

export interface FormFieldShowIf {
  key: string;
  equals: string;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "email" | "dropdown" | "date" | "file" | "number" | "checkbox";
  required: boolean;
  options?: string[];
  showIf?: FormFieldShowIf | null;
}

/** Prefer native `fields` when present; googleFormUrl optional embed. */
export interface FormTemplate {
  id: string;
  name: string;
  description?: string;
  googleFormUrl: string;
  googleFormEmbedUrl?: string;
  fields?: FormField[];
  mode?: "google" | "native";
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  clientId: string;
  formTemplateId: string;
  taskId: string | null;
  responses: Record<string, string | number | boolean | null>;
  status: FormStatus;
  riskScore: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string;
}

export interface ActivityLog {
  id: string;
  clientId: string;
  actorId: string;
  actorName: string;
  action: string;
  timestamp: string;
  meta: Record<string, unknown>;
}

export type NotificationKind =
  | "task_assigned"
  | "task_overdue"
  | "task_comment"
  | "task_escalated"
  | "document_reviewed"
  | "document_expiring"
  | "form_reviewed"
  | "message"
  | "nudge"
  | "mention"
  | "system";

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  clientId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PortalMessage {
  id: string;
  clientId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  body: string;
  createdAt: string;
}

export type WebhookEvent =
  | "client.created"
  | "client.completed"
  | "client.invited"
  | "task.completed"
  | "task.overdue"
  | "document.approved"
  | "document.rejected"
  | "form.submitted";

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}

export interface IntegrationRun {
  id: string;
  userId: string;
  toolkit: string;
  action: string;
  success: boolean;
  detail: string;
  createdAt: string;
}

export interface SavedSmartList {
  id: string;
  ownerId: string;
  name: string;
  filter: {
    status?: ClientStatus | null;
    tag?: string | null;
    assignedTeamMemberId?: string | null;
    pipelineStage?: PipelineStage | null;
    q?: string | null;
  };
  createdAt: string;
}

/** A persisted, text-only agent turn. Tool payloads and credentials are never stored. */
export interface AgentChatMessage {
  id: string;
  userId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface AgentChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  clientId: string | null;
  permissions?: StaffPermission[];
}

export interface ClientWithProgress extends Client {
  progress: number;
  totalTasks: number;
  completedTasks: number;
  assignedTeamMemberName?: string | null;
  vesselCount?: number;
}
