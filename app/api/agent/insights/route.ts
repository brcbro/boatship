import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { buildHodiClientInsights } from "@/lib/hodi-insights";
import { getStore } from "@/lib/store";
import { requireClientAccess } from "@/lib/client-access";

export const runtime = "nodejs";

/** Read-only, evidence-backed project memory and next-best-action results for Hodi. */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const clientId = new URL(req.url).searchParams.get("clientId") || undefined;
    if (clientId) {
      await requireClientAccess(session, clientId);
      if (!await (await getStore()).getClient(clientId)) throw jsonError("Client not found", 404);
    }
    const insights = await buildHodiClientInsights(session, clientId);
    return { mode: "read_only", insights };
  });
}
