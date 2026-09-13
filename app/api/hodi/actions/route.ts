import { handleApi, jsonError } from "@/lib/api";
import { requireSession, requireRoles } from "@/lib/auth";
import { listHodiActionProposals, reviewHodiActionProposal } from "@/lib/hodi-queue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const value = new URL(req.url).searchParams.get("status") || "pending";
    if (![
      "pending", "approved", "rejected", "executing", "consumed", "expired",
    ].includes(value)) throw jsonError("Invalid action proposal status", 400);
    return { proposals: await listHodiActionProposals(session, value) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!id || !status) throw jsonError("id and status (approved or rejected) are required", 400);
    if (status === "rejected" && !reason) throw jsonError("A reason is required when rejecting", 400);
    return { proposal: await reviewHodiActionProposal(id, session, status, reason) };
  });
}
