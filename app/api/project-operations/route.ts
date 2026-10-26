import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { ENGAGEMENTS } from "@/lib/engagements";
import { validateResourceEngagement, resourceInEngagement } from "@/lib/engagement-resources";
import { requireStaffPermission } from "@/lib/rbac";
import { approvalReviewError, createApproval, createMilestone, executeProjectIntegration, listProjectOps, updateApproval, weeklyEvidenceReport } from "@/lib/project-operations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const requestedClientId = url.searchParams.get("clientId") || undefined;
    const clientId = session.role === "client" ? session.clientId || undefined : requestedClientId;
    if (requestedClientId && !await canAccessClient(session, requestedClientId)) throw jsonError("Forbidden", 403);
    if (clientId && !await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    const selected = url.searchParams.get("engagementId");
    if (selected && selected !== "account") {
      const owner = clientId || (await ENGAGEMENTS.get(selected))?.clientId;
      if (!owner || !await canAccessClient(session, owner)) throw jsonError("Forbidden", 403);
      await validateResourceEngagement(owner, selected, undefined, true);
    }
    const ops = await listProjectOps();
    const reports = session.role === "client" ? [] : await weeklyEvidenceReport(clientId);
    const visibleIds = session.role === "team"
      ? new Set((await filterAssignedClients(session, await (await getStore()).listClients())).map((client) => client.id))
      : null;
    const visible = (id: string) =>
      (session.role === "client" ? id === session.clientId : !clientId || id === clientId) &&
      (!visibleIds || visibleIds.has(id));
    const tasks = clientId ? await (await getStore()).listTasks(clientId) : [];
    const includeAccountWide = url.searchParams.get("includeAccountWide") === "1" || url.searchParams.get("includeAccountWide") === "true";
    const scoped = (item: { clientId: string; engagementId?: string | null }) => visible(item.clientId) && resourceInEngagement(item, tasks, selected, includeAccountWide);
    return { workspace: session.role === "client" ? undefined : ops.workspace, milestones: ops.milestones.filter(scoped), approvals: ops.approvals.filter(scoped), schedules: ops.schedules.filter((item) => visible(item.clientId)), reports: reports.filter((item) => visible(item.clientId)) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");
    const clientId = String(body.clientId || "");
    if (clientId && !await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    if (action === "milestone") {
      await requireRoles(req, ["admin", "team"]);
      if (!clientId || !String(body.title || "").trim()) throw jsonError("clientId and title are required", 400);
      const taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String) : [];
      const engagementId = await validateResourceEngagement(clientId, body.engagementId, taskIds[0]);
      for (const id of taskIds.slice(1)) {
        const linked = await validateResourceEngagement(clientId, engagementId, id);
        if (linked !== engagementId) throw jsonError("Milestone tasks must share one engagement.", 400);
      }
      const dueDate = body.dueDate ? String(body.dueDate) : null;
      if (dueDate && Number.isNaN(Date.parse(dueDate))) throw jsonError("Choose a valid due date.", 400);
      return { milestone: await createMilestone({ clientId, engagementId, title: String(body.title).trim(), description: String(body.description || "").trim(), dueDate, status: "planned", taskIds }) };
    }
    if (action === "approval") {
      if (!clientId || !String(body.subject || "").trim()) throw jsonError("clientId and subject are required", 400);
      if (session.role !== "client") await requireRoles(req, ["admin", "team"]);
      const engagementId = await validateResourceEngagement(clientId, body.engagementId);
      return { approval: await createApproval({ clientId, engagementId, subject: String(body.subject).trim(), description: String(body.description || "").trim(), kind: body.kind === "design" || body.kind === "release" ? body.kind : "document", requestedBy: session.uid, requestedByRole: session.role }) };
    }
    if (action === "approval-review") {
      await requireRoles(req, ["admin", "team", "client"]);
      const approvalId = String(body.approvalId || "");
      const status = body.status;
      const reviewNote = String(body.reviewNote || "").trim();
      if (!approvalId || (status !== "approved" && status !== "changes_requested")) throw jsonError("A valid approval and decision are required", 400);
      if (status === "changes_requested" && !reviewNote) throw jsonError("Explain what needs to change", 400);
      if (reviewNote.length > 2000) throw jsonError("Review note must be 2000 characters or less", 400);
      const approval = (await listProjectOps()).approvals.find((item) => item.id === approvalId);
      if (!approval) throw jsonError("Approval not found", 404);
      if (!await canAccessClient(session, approval.clientId)) throw jsonError("Forbidden", 403);
      await validateResourceEngagement(approval.clientId, approval.engagementId);
      if (approval.status !== "pending") throw jsonError("This approval has already been reviewed", 409);
      const requesterRole = approval.requestedByRole ?? (await (await getStore()).getUser(approval.requestedBy))?.role ?? null;
      const reviewError = approvalReviewError(approval, session, requesterRole);
      if (reviewError) throw jsonError(reviewError, 403);
      const updated = await updateApproval(approvalId, status, session.uid, reviewNote || null);
      if (!updated) throw jsonError("This approval has already been reviewed", 409);
      return { approval: updated };
    }
    if (action === "integration") {
      await requireRoles(req, ["admin", "team"]);
      requireStaffPermission(session, "integrations.manage");
      const integration = body.integration;
      if (integration !== "calendar" && integration !== "docs" && integration !== "sheets" && integration !== "telegram") throw jsonError("Unsupported integration", 400);
      return { integration: await executeProjectIntegration({ userId: session.uid, action: integration, arguments: (body.arguments && typeof body.arguments === "object" ? body.arguments : {}) as Record<string, unknown> }) };
    }
    throw jsonError("Unknown project operation", 400);
  });
}
