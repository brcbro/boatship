import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { executeHodiAction, proposeHodiAction, type HodiAction } from "@/lib/hodi-actions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      mode?: "propose" | "execute";
      action?: HodiAction;
      payload?: Record<string, unknown>;
      approvalToken?: string;
    };
    if (!body.action || !body.payload || typeof body.payload !== "object") {
      throw jsonError("action and payload are required", 400);
    }
    if (body.mode === "propose") return proposeHodiAction(body.action, body.payload, session);
    if (body.mode !== "execute") throw jsonError('mode must be "propose" or "execute"', 400);
    if (!body.approvalToken?.trim()) throw jsonError("An explicit approvalToken is required to execute this action", 403);
    return executeHodiAction(body.action, body.payload, body.approvalToken, session);
  });
}
