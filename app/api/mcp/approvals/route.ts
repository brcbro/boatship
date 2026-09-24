import { handleApi, jsonError } from "@/lib/api";
import { getSessionFromRequest } from "@/lib/auth";
import { isApprovalReviewer, listMcpWriteApprovals, reviewMcpWriteApproval, type ApprovalDecision } from "@/lib/mcp-controls";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    if (!session || !isApprovalReviewer(session)) throw jsonError("Manager or admin access required", 403);
    const value = new URL(req.url).searchParams.get("status");
    const status = value === "approved" || value === "rejected" || value === "all" ? value : "pending";
    return { approvals: await listMcpWriteApprovals(status, session) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await getSessionFromRequest(req);
    if (!session || !isApprovalReviewer(session)) throw jsonError("Manager or admin access required", 403);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const approvalId = typeof body.approvalId === "string" ? body.approvalId.trim() : "";
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision as ApprovalDecision : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!approvalId || !decision) throw jsonError("approvalId and a valid decision are required", 400);
    if (decision === "rejected" && !reason) throw jsonError("A reason is required when rejecting", 400);
    return { approval: await reviewMcpWriteApproval({ approvalId, decision, reason, reviewer: session }) };
  });
}
