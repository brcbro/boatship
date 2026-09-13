import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  HODI_COMMUNICATION_CHANNELS,
  HODI_COMMUNICATION_TYPES,
  listHodiCommunicationProposals,
  proposeHodiCommunication,
  type HodiCommunicationPayload,
  type HodiCommunicationStatus,
  type HodiCommunicationType,
} from "@/lib/hodi-communications";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const statusValue = new URL(req.url).searchParams.get("status") || undefined;
    const statuses: HodiCommunicationStatus[] = ["pending", "approved_ready_for_handoff", "rejected", "expired"];
    if (statusValue && !statuses.includes(statusValue as HodiCommunicationStatus)) {
      throw jsonError("Unsupported communication status", 400);
    }
    return {
      communicationTypes: HODI_COMMUNICATION_TYPES,
      channels: HODI_COMMUNICATION_CHANNELS,
      sending: "disabled_until_verified_channel_contract",
      proposals: await listHodiCommunicationProposals(session, statusValue as HodiCommunicationStatus | undefined),
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { type?: HodiCommunicationType; payload?: HodiCommunicationPayload };
    if (!body.type || !body.payload || typeof body.payload !== "object") {
      throw jsonError("type and payload are required", 400);
    }
    return proposeHodiCommunication(body.type, body.payload, session);
  });
}
