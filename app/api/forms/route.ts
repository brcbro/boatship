import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const forms = await store.listForms(clientId);
    return { forms };
  });
}
