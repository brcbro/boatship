import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { reviewHodiActionProposal } from "@/lib/hodi-queue";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const proposal = await getPrisma().hodiActionProposal.findUnique({ where: { id: (await params).id } });
    if (!proposal) throw jsonError("Action proposal not found", 404);
    if (session.role !== "admin" && proposal.userId !== session.uid) throw jsonError("Forbidden", 403);
    return { proposal };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!status) throw jsonError("status must be approved or rejected", 400);
    return { proposal: await reviewHodiActionProposal((await params).id, session, status, reason) };
  });
}
