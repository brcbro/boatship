import { createHash, randomUUID } from "crypto";
import { Collection, FirestoreError, nowIso, type Where } from "@/lib/firestore";
import { MCP_AUDIT_EVENTS, type McpAuditEventDoc } from "@/lib/mcp-auth";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { consumeRateLimit } from "@/lib/rate-limit";
import type { McpContext } from "@/lib/mcp-context";
import { sanitizeForMcp, visibleTask } from "@/lib/mcp-context";
import { clientCanSeeDocument, clientSafeActivity } from "@/lib/client-projection";
import type { AuthSession, ActivityLog } from "@/types";
import { hasPermission } from "@/lib/rbac";

const MAX_REQUESTS = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 120);

export async function checkMcpRateLimit(identityId: string) {
  return consumeRateLimit({ scope: "mcp", identity: identityId, max: MAX_REQUESTS, windowSeconds: 60 });
}

export function deviceFingerprint(req: Request) {
  const value = [req.headers.get("user-agent") || "", req.headers.get("x-forwarded-for") || ""].join("|");
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Audit events inside the retention window, newest first. One equality
 * filter goes to Firestore; the createdAt range is only sent when there is
 * no equality (otherwise it would need a composite index) and is applied in
 * memory instead.
 */
async function auditEventsInRetention(equality: Where | null, take: number): Promise<McpAuditEventDoc[]> {
  const retentionDays = Number(process.env.MCP_RETENTION_DAYS || 365);
  const cutoff = retentionDays > 0 ? new Date(Date.now() - retentionDays * 86400000).toISOString() : null;
  const where: Where[] = equality ? [equality] : cutoff ? [{ field: "createdAt", op: ">=", value: cutoff }] : [];
  const events = await MCP_AUDIT_EVENTS.find(where);
  return events
    .filter((event) => !cutoff || event.createdAt >= cutoff)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, take);
}

export async function auditExport(identityId?: string, userId?: string) {
  const equality: Where | null = identityId ? { field: "identityId", op: "==", value: identityId } : userId ? { field: "userId", op: "==", value: userId } : null;
  const events = await auditEventsInRetention(equality, 10_000);
  return events.map((event) => sanitizeForMcp({ ...event }));
}

export async function contextPack(context: McpContext, taskId: string) {
  const task = await visibleTask(context, taskId);
  if (!task) return null;
  const store = await getStore();
  const [client, comments, allDocuments, forms, allActivity, tasks] = await Promise.all([
    store.getClient(task.clientId),
    store.listTaskComments(task.id),
    store.listDocuments(task.clientId),
    store.listForms(task.clientId),
    store.listActivity(task.clientId),
    store.listTasks(task.clientId),
  ]);
  // Client tokens get the same projection as the client REST routes.
  const isClient = context.session.role === "client";
  const tasksById = new Map(tasks.map((item) => [item.id, item]));
  const documents = isClient ? allDocuments.filter((item) => clientCanSeeDocument(item, tasksById)) : allDocuments;
  const activity = isClient ? clientSafeActivity(allActivity, tasksById, new Map(allDocuments.map((item) => [item.id, item]))) : allActivity;
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
  const events = await auditEventsInRetention({ field: "identityId", op: "==", value: identityId }, Math.min(Math.max(limit, 1), 200));
  return sanitizeForMcp(events.map((event) => ({ toolName: event.toolName, resource: event.resource, action: event.action, success: event.success, metadata: event.metadata, createdAt: event.createdAt })));
}

type ApprovalInput = { context: McpContext; action: string; taskId: string; payload: Record<string, unknown>; approved?: boolean; approvalId?: string };

/**
 * One document per applied approval, created with an `exists: false`
 * precondition before the write runs: of two concurrent applications of the
 * same approvalId exactly one creates it, the other is refused.
 */
export type McpApprovalApplicationDoc = { approvalId: string; taskId: string; action: string; userId: string; payloadHash: string; appliedAt: string };
export const MCP_APPROVAL_APPLICATIONS = new Collection<McpApprovalApplicationDoc>("McpApprovalApplication");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of the payload as stored on the request (sanitized), independent of key order. */
export function approvalPayloadHash(payload: Record<string, unknown>) {
  return `sha256:${createHash("sha256").update(canonicalJson(sanitizeForMcp(payload))).digest("hex")}`;
}

function forbidden(message: string) {
  return new Response(JSON.stringify({ error: message }), { status: 403, headers: { "Content-Type": "application/json" } });
}

export type ApprovalDecision = "approved" | "rejected";

export function isApprovalReviewer(session: AuthSession) {
  return hasPermission(session, "team.manage");
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

export async function listMcpWriteApprovals(status: "pending" | "approved" | "rejected" | "all" = "pending", reviewer?: AuthSession) {
  const store = await getStore();
  const activities = await store.listAllActivity();
  const requests = activities.filter((entry) => entry.action === "mcp.approval.requested" && typeof entry.meta?.approvalId === "string");
  const results = [];
  for (const request of requests) {
    if (reviewer && !await canAccessClient(reviewer, request.clientId)) continue;
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
  if (!await canAccessClient(input.reviewer, request.clientId)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Separation of duties: a reviewer never decides their own request.
  if (request.actorId === input.reviewer.uid) throw forbidden("You cannot review your own MCP write request");
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
  if (input.context.session.role === "team" && !hasPermission(input.context.session, "clients.manage")) {
    return { status: "blocked", message: "Current staff permission does not allow this action" };
  }
  const task = await visibleTask(input.context, input.taskId);
  if (!task) return { status: "blocked", message: "Task not found or not authorized" };
  const store = input.context.store;
  if (!input.approved) {
    const approvalId = randomUUID();
    const payload = sanitizeForMcp(input.payload);
    await store.addActivity({ clientId: task.clientId, actorId: input.context.session.uid, actorName: input.context.session.name, action: "mcp.approval.requested", meta: { approvalId, taskId: task.id, action: input.action, payload, payloadHash: approvalPayloadHash(payload) } });
    return { status: "approval_required", approvalId, action: input.action, taskId: task.id };
  }
  const approvals = await store.listActivity(task.clientId);
  const approvedRequest = input.approvalId && approvals.find((entry) => entry.action === "mcp.approval.requested" && entry.meta?.approvalId === input.approvalId && entry.meta?.taskId === task.id && entry.meta?.action === input.action);
  if (!approvedRequest) return { status: "blocked", message: "A matching approvalId is required before applying this write" };
  // An approval is bound to the person who asked for it.
  if (approvedRequest.actorId !== input.context.session.uid) return { status: "blocked", message: "This approvalId belongs to another requester" };
  const decision = approvalDecision(approvals, input.approvalId || "");
  if (decision?.status === "rejected") return { status: "blocked", message: decision.reason ? `This request was rejected: ${decision.reason}` : "This request was rejected" };
  if (decision?.status !== "approved") return { status: "approval_pending", approvalId: input.approvalId, message: "A manager or admin must approve this request before it can be applied" };
  if (approvals.some((entry) => entry.action === `mcp.${input.action}.applied` && entry.meta?.approvalId === input.approvalId)) return { status: "blocked", message: "This approvalId has already been used" };

  // The write applies exactly what the reviewer saw: the stored payload. A
  // differing payload supplied now is refused rather than silently replaced.
  const approvedPayload = (approvedRequest.meta.payload && typeof approvedRequest.meta.payload === "object" ? approvedRequest.meta.payload : {}) as Record<string, unknown>;
  const approvedHash = typeof approvedRequest.meta.payloadHash === "string" ? approvedRequest.meta.payloadHash : approvalPayloadHash(approvedPayload);
  const suppliedHash = approvalPayloadHash(input.payload);
  if (suppliedHash !== approvedHash || approvalPayloadHash(approvedPayload) !== approvedHash) {
    return { status: "blocked", message: "The payload differs from the approved request; request a new approval" };
  }
  const payload = approvedPayload;

  let apply: (() => Promise<Record<string, unknown>>) | null = null;
  const actor = { actorId: input.context.session.uid, actorName: input.context.session.name };
  if (input.action === "update_task_status") {
    const status = payload.status;
    if (!["pending", "in_progress", "completed", "blocked"].includes(String(status))) return { status: "failed", message: "Invalid task status" };
    apply = async () => {
      // Staff-only bookkeeping never leaves through an MCP result.
      const { watcherIds: _watchers, escalatedAt: _escalated, reminderSentAt: _reminder, internalNotes: _notes, ...updated } = await store.updateTask(task.id, { status: status as typeof task.status });
      void [_watchers, _escalated, _reminder, _notes];
      return { task: updated };
    };
  } else if (input.action === "add_comment") {
    const body = String(payload.body || "").trim();
    if (!body) return { status: "failed", message: "body is required" };
    apply = async () => ({ comment: await store.addTaskComment({ taskId: task.id, clientId: task.clientId, authorId: actor.actorId, authorName: actor.actorName, body, mentionUserIds: [] }) });
  } else if (input.action === "create_follow_up") {
    const title = String(payload.title || "").trim();
    if (!title) return { status: "failed", message: "title is required" };
    apply = async () => ({ task: await store.createTask({ clientId: task.clientId, title, description: String(payload.description || ""), type: task.type, assignedTo: task.assignedTo, assignedRole: task.assignedRole, status: "pending", dueDate: typeof payload.dueDate === "string" ? payload.dueDate : null, order: task.order + 1, formTemplateId: null, requiresUpload: false }) });
  } else if (input.action === "request_review" || input.action === "attach_evidence") {
    apply = async () => {
      await store.addActivity({ clientId: task.clientId, ...actor, action: `mcp.${input.action}`, meta: { taskId: task.id, ...sanitizeForMcp(payload) } });
      return {};
    };
  } else return { status: "failed", message: "Unsupported action" };

  // Compare-and-set: claim the approval before writing. A concurrent second
  // application fails the `exists: false` precondition and writes nothing.
  const approvalId = input.approvalId!;
  try {
    await MCP_APPROVAL_APPLICATIONS.create(approvalId, { approvalId, taskId: task.id, action: input.action, userId: actor.actorId, payloadHash: approvedHash, appliedAt: nowIso() });
  } catch (error) {
    if (error instanceof FirestoreError && (error.status === "ALREADY_EXISTS" || error.httpStatus === 409)) return { status: "blocked", message: "This approvalId has already been used" };
    throw error;
  }
  let applied: Record<string, unknown>;
  try {
    applied = await apply();
  } catch (error) {
    // The single write failed, so the approval may be used again.
    await MCP_APPROVAL_APPLICATIONS.delete(approvalId).catch(() => undefined);
    throw error;
  }

  await store.addActivity({ clientId: task.clientId, ...actor, action: `mcp.${input.action}.applied`, meta: { taskId: task.id, approvalId } });
  return sanitizeForMcp({ status: "applied", taskId: task.id, action: input.action, ...applied });
}
