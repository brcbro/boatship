import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/rbac";
import { createApproval, createMilestone, executeProjectIntegration, listProjectOps, updateApproval, weeklyEvidenceReport } from "@/lib/project-operations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId") || undefined;
    if (clientId && !canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    const ops = await listProjectOps();
    const reports = session.role === "client" ? [] : await weeklyEvidenceReport(clientId);
    return { ...ops, milestones: clientId ? ops.milestones.filter((item) => item.clientId === clientId) : ops.milestones, approvals: clientId ? ops.approvals.filter((item) => item.clientId === clientId) : ops.approvals, reports };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");
    const clientId = String(body.clientId || "");
    if (clientId && !canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
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
      return { approval: await updateApproval(String(body.approvalId || ""), body.status === "approved" ? "approved" : "changes_requested", session.uid) };
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
