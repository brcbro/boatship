import { createHash, randomUUID } from "crypto";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import type { McpContext } from "@/lib/mcp-context";
import { sanitizeForMcp, visibleTask } from "@/lib/mcp-context";
import type { AuthSession, ActivityLog } from "@/types";

const buckets = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 120);

export function checkMcpRateLimit(identityId: string) {
  const now = Date.now();
  const current = buckets.get(identityId);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(identityId, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS;
}

export function deviceFingerprint(req: Request) {
  const value = [req.headers.get("user-agent") || "", req.headers.get("x-forwarded-for") || ""].join("|");
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function auditExport(identityId?: string, userId?: string) {
  const retentionDays = Number(process.env.MCP_RETENTION_DAYS || 365);
  const createdAt = retentionDays > 0 ? { gte: new Date(Date.now() - retentionDays * 86400000) } : undefined;
  const events = await getPrisma().mcpAuditEvent.findMany({
    where: identityId ? { identityId, createdAt } : userId ? { userId, createdAt } : createdAt ? { createdAt } : undefined,
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
  return events.map((event) => sanitizeForMcp({ ...event, createdAt: event.createdAt.toISOString() }));
}

export async function contextPack(context: McpContext, taskId: string) {
  const task = await visibleTask(context, taskId);
  if (!task) return null;
  const store = await getStore();
  const [client, comments, documents, forms, activity] = await Promise.all([
    store.getClient(task.clientId),
    store.listTaskComments(task.id),
    store.listDocuments(task.clientId),
    store.listForms(task.clientId),
    store.listActivity(task.clientId),
  ]);
  return sanitizeForMcp({
    task,
    project: client ? { id: client.id, name: client.name, companyName: client.companyName, status: client.status, pipelineStage: client.pipelineStage, tags: client.tags } : null,
    relevant: {
      comments: comments.slice(-20),
      documents: documents.filter((item) => item.taskId === task.id).map((item) => ({ id: item.id, taskId: item.taskId, fileName: item.fileName, storagePath: item.storagePath, uploadedBy: item.uploadedBy, status: item.status, reviewNote: item.reviewNote, uploadedAt: item.uploadedAt, contentType: item.contentType, size: item.size, documentType: item.documentType, expiresAt: item.expiresAt, versions: item.versions })),
      forms: forms.filter((item) => item.taskId === task.id),
      activity: activity.filter((item) => item.meta?.taskId === task.id).slice(0, 30),
    },
    generatedAt: new Date().toISOString(),
  });
}

export async function sessionHistory(identityId: string, limit = 50) {
  const retentionDays = Number(process.env.MCP_RETENTION_DAYS || 365);
  const createdAt = retentionDays > 0 ? { gte: new Date(Date.now() - retentionDays * 86400000) } : undefined;
  const events = await getPrisma().mcpAuditEvent.findMany({ where: { identityId, ...(createdAt ? { createdAt } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 200) });
  return sanitizeForMcp(events.map((event) => ({ toolName: event.toolName, resource: event.resource, action: event.action, success: event.success, metadata: event.metadata, createdAt: event.createdAt.toISOString() })));
}

type ApprovalInput = { context: McpContext; action: string; taskId: string; payload: Record<string, unknown>; approved?: boolean; approvalId?: string };

export type ApprovalDecision = "approved" | "rejected";

export function isApprovalReviewer(session: AuthSession) {
  return session.role === "admin" || (session.role === "team" && session.permissions?.includes("team.manage"));
}

function approvalDecision(activities: ActivityLog[], approvalId: string) {
  const decisions = activities
    .filter((entry) => entry.meta?.approvalId === approvalId && (entry.action === "mcp.approval.approved" || entry.action === "mcp.approval.rejected"))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const latest = decisions[0];
  if (!latest) return null;
  return {
    status: latest.action.endsWith("approved") ? "approved" as const : "rejected" as const,
    reason: typeof latest.meta.reason === "string" ? latest.meta.reason : null,
    reviewedAt: latest.timestamp,
    reviewerId: latest.actorId,
    reviewerName: latest.actorName,
  };
}

export async function listMcpWriteApprovals(status: "pending" | "approved" | "rejected" | "all" = "pending") {
  const store = await getStore();
  const activities = await store.listAllActivity();
  const requests = activities.filter((entry) => entry.action === "mcp.approval.requested" && typeof entry.meta?.approvalId === "string");
  const results = [];
  for (const request of requests) {
    const approvalId = String(request.meta.approvalId);
    const decision = approvalDecision(activities, approvalId);
    const resolvedStatus = decision?.status || "pending";
    if (status !== "all" && resolvedStatus !== status) continue;
    const taskId = typeof request.meta.taskId === "string" ? request.meta.taskId : null;
    const task = taskId ? await store.getTask(taskId) : null;
    results.push({
      approvalId,
      status: resolvedStatus,
      action: typeof request.meta.action === "string" ? request.meta.action : "unknown",
      payload: sanitizeForMcp(request.meta.payload || {}),
      requestedAt: request.timestamp,
      requester: { id: request.actorId, name: request.actorName },
      task: task ? { id: task.id, title: task.title, clientId: task.clientId, status: task.status } : { id: taskId, title: "Task unavailable", clientId: request.clientId, status: null },
      decision,
    });
  }
  return results.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function reviewMcpWriteApproval(input: { approvalId: string; decision: ApprovalDecision; reason?: string; reviewer: AuthSession }) {
  if (!isApprovalReviewer(input.reviewer)) throw new Error("Only managers or admins can review MCP write requests");
  const store = await getStore();
  const activities = await store.listAllActivity();
  const request = activities.find((entry) => entry.action === "mcp.approval.requested" && entry.meta?.approvalId === input.approvalId);
  if (!request) throw new Error("MCP approval request not found");
  if (input.decision === "rejected" && !input.reason?.trim()) throw new Error("A reason is required when rejecting a request");
  const current = approvalDecision(activities, input.approvalId);
  if (current) throw new Error(`This request has already been ${current.status}`);
  const event = await store.addActivity({
    clientId: request.clientId,
    actorId: input.reviewer.uid,
    actorName: input.reviewer.name,
    action: `mcp.approval.${input.decision}`,
    meta: { approvalId: input.approvalId, reason: input.reason?.trim() || null, requestAction: request.meta.action },
  });
  await store.createNotification({ userId: request.actorId, kind: "system", title: `MCP request ${input.decision}`, body: input.reason?.trim() || `Your ${String(request.meta.action || "write")} request was ${input.decision}.`, href: "/tasks", clientId: request.clientId });
  return { approvalId: input.approvalId, status: input.decision, reason: input.reason?.trim() || null, reviewedAt: event.timestamp, reviewer: { id: input.reviewer.uid, name: input.reviewer.name } };
}

export async function runApprovedTaskAction(input: ApprovalInput) {
  const task = await visibleTask(input.context, input.taskId);
  if (!task) return { status: "blocked", message: "Task not found or not authorized" };
  const store = input.context.store;
  if (!input.approved) {
    const approvalId = randomUUID();
    await store.addActivity({ clientId: task.clientId, actorId: input.context.session.uid, actorName: input.context.session.name, action: "mcp.approval.requested", meta: { approvalId, taskId: task.id, action: input.action, payload: sanitizeForMcp(input.payload) } });
    return { status: "approval_required", approvalId, action: input.action, taskId: task.id };
  }
  const approvals = await store.listActivity(task.clientId);
  const approvedRequest = input.approvalId && approvals.find((entry) => entry.action === "mcp.approval.requested" && entry.meta?.approvalId === input.approvalId && entry.meta?.taskId === task.id && entry.meta?.action === input.action);
  if (!approvedRequest) return { status: "blocked", message: "A matching approvalId is required before applying this write" };
  const decision = approvalDecision(approvals, input.approvalId || "");
  if (decision?.status === "rejected") return { status: "blocked", message: decision.reason ? `This request was rejected: ${decision.reason}` : "This request was rejected" };
  if (decision?.status !== "approved") return { status: "approval_pending", approvalId: input.approvalId, message: "A manager or admin must approve this request before it can be applied" };
  if (approvals.some((entry) => entry.action === `mcp.${input.action}.applied` && entry.meta?.approvalId === input.approvalId)) return { status: "blocked", message: "This approvalId has already been used" };

  const result: Record<string, unknown> = { status: "applied", taskId: task.id, action: input.action };
  if (input.action === "update_task_status") {
    const status = input.payload.status;
    if (!["pending", "in_progress", "completed", "blocked"].includes(String(status))) return { status: "failed", message: "Invalid task status" };
    result.task = await store.updateTask(task.id, { status: status as typeof task.status });
  } else if (input.action === "add_comment") {
    const body = String(input.payload.body || "").trim();
    if (!body) return { status: "failed", message: "body is required" };
    result.comment = await store.addTaskComment({ taskId: task.id, clientId: task.clientId, authorId: input.context.session.uid, authorName: input.context.session.name, body, mentionUserIds: [] });
  } else if (input.action === "create_follow_up") {
    const title = String(input.payload.title || "").trim();
    if (!title) return { status: "failed", message: "title is required" };
    result.task = await store.createTask({ clientId: task.clientId, title, description: String(input.payload.description || ""), type: task.type, assignedTo: task.assignedTo, assignedRole: task.assignedRole, status: "pending", dueDate: typeof input.payload.dueDate === "string" ? input.payload.dueDate : null, order: task.order + 1, formTemplateId: null, requiresUpload: false });
  } else if (input.action === "request_review" || input.action === "attach_evidence") {
    await store.addActivity({ clientId: task.clientId, actorId: input.context.session.uid, actorName: input.context.session.name, action: `mcp.${input.action}`, meta: { taskId: task.id, ...sanitizeForMcp(input.payload) } });
  } else return { status: "failed", message: "Unsupported action" };

  await store.addActivity({ clientId: task.clientId, actorId: input.context.session.uid, actorName: input.context.session.name, action: `mcp.${input.action}.applied`, meta: { taskId: task.id, approvalId: input.approvalId } });
  return sanitizeForMcp(result);
}
