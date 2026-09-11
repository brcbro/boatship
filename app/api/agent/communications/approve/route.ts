import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { approveHodiCommunication, type HodiCommunicationPayload, type HodiCommunicationType } from "@/lib/hodi-communications";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      type?: HodiCommunicationType;
      payload?: HodiCommunicationPayload;
      approvalToken?: unknown;
    };
    if (!body.type || !body.payload || typeof body.payload !== "object") {
      throw jsonError("type and payload are required", 400);
    }
    if (typeof body.approvalToken !== "string" || !body.approvalToken.trim()) {
      throw jsonError("An explicit approval token is required", 400);
    }
    return approveHodiCommunication(body.type, body.payload, body.approvalToken, session);
  });
}
