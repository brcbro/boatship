import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { clientSafeActivity } from "@/lib/client-projection";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * List activity for a client — used by admin client detail Activity tab.
 * A client session receives only the allowlisted actions in
 * `CLIENT_VISIBLE_ACTIVITY`, with staff meta (patches, evidence, notes) removed.
 */
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
    if (session.role === "client") {
      const [tasks, documents] = await Promise.all([store.listTasks(clientId), store.listDocuments(clientId)]);
      return {
        activity: clientSafeActivity(
          activity,
          new Map(tasks.map((task) => [task.id, task])),
          new Map(documents.map((document) => [document.id, document])),
        ),
      };
    }
    return { activity };
  });
}
