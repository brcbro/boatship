import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { resourceEngagementId, resourceInEngagement, validateResourceEngagement } from "@/lib/engagement-resources";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const query = new URL(req.url).searchParams;
    const clientId = query.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    if (!await store.getClient(clientId)) throw jsonError("Client not found", 404);
    const selected = query.get("engagementId");
    if (selected && selected !== "account") await validateResourceEngagement(clientId, selected, undefined, true);
    const includeAccountWide = query.get("includeAccountWide") === "1" || query.get("includeAccountWide") === "true";
    const [forms, tasks] = await Promise.all([store.listForms(clientId), store.listTasks(clientId)]);
    return { forms: forms.filter((form) => resourceInEngagement(form, tasks, selected, includeAccountWide)).map((form) => ({ ...form, engagementId: resourceEngagementId(form, tasks) })) };
  });
}
