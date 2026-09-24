import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** List activity for a client — used by admin client detail Activity tab. */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const activity = await store.listActivity(clientId);
    return { activity };
  });
}
