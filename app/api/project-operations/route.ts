import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { createApproval, createMilestone, executeProjectIntegration, listProjectOps, updateApproval, weeklyEvidenceReport } from "@/lib/project-operations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const requestedClientId = url.searchParams.get("clientId") || undefined;
    const clientId = session.role === "client" ? session.clientId || undefined : requestedClientId;
    if (requestedClientId && !await canAccessClient(session, requestedClientId)) throw jsonError("Forbidden", 403);
    if (clientId && !await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    const ops = await listProjectOps();
    const reports = session.role === "client" ? [] : await weeklyEvidenceReport(clientId);
    const visibleIds = session.role === "team"
      ? new Set((await filterAssignedClients(session, await (await getStore()).listClients())).map((client) => client.id))
      : null;
    const visible = (id: string) =>
      (session.role === "client" ? id === session.clientId : !clientId || id === clientId) &&
      (!visibleIds || visibleIds.has(id));
    return { ...ops, milestones: ops.milestones.filter((item) => visible(item.clientId)), approvals: ops.approvals.filter((item) => visible(item.clientId)), reports: reports.filter((item) => visible(item.clientId)) };
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
      return { milestone: await createMilestone({ clientId, title: String(body.title).trim(), description: String(body.description || "").trim(), dueDate: body.dueDate ? String(body.dueDate) : null, status: "planned", taskIds: Array.isArray(body.taskIds) ? body.taskIds.map(String) : [] }) };
    }
    if (action === "approval") {
      if (!clientId || !String(body.subject || "").trim()) throw jsonError("clientId and subject are required", 400);
      if (session.role !== "client") await requireRoles(req, ["admin", "team"]);
      return { approval: await createApproval({ clientId, subject: String(body.subject).trim(), description: String(body.description || "").trim(), kind: body.kind === "design" || body.kind === "release" ? body.kind : "document", requestedBy: session.uid }) };
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
      if (approval.status !== "pending") throw jsonError("This approval has already been reviewed", 409);
      const updated = await updateApproval(approvalId, status, session.uid, reviewNote || null);
      if (!updated) throw jsonError("This approval has already been reviewed", 409);
      return { approval: updated };
    }
    if (action === "integration") {
      await requireRoles(req, ["admin", "team"]);
      const integration = body.integration;
      if (integration !== "calendar" && integration !== "docs" && integration !== "sheets" && integration !== "telegram") throw jsonError("Unsupported integration", 400);
      return { integration: await executeProjectIntegration({ userId: session.uid, action: integration, arguments: (body.arguments && typeof body.arguments === "object" ? body.arguments : {}) as Record<string, unknown> }) };
    }
    throw jsonError("Unknown project operation", 400);
  });
}
