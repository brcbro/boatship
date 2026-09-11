import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { executeHodiAction, type HodiAction } from "@/lib/hodi-actions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      action?: HodiAction;
      payload?: Record<string, unknown>;
      approvalToken?: unknown;
    };
    if (!body.action || !body.payload || typeof body.payload !== "object") {
      throw jsonError("action and payload are required", 400);
    }
    if (typeof body.approvalToken !== "string" || !body.approvalToken.trim()) {
      throw jsonError("An explicit approvalToken is required before Hodi can make changes", 400);
    }
    return {
      result: await executeHodiAction(
        body.action,
        body.payload,
        body.approvalToken,
        session
      ),
    };
  });
}
