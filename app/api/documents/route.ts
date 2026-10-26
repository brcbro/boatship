import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";
import { clientCanSeeDocument } from "@/lib/client-projection";
import { validateResourceEngagement, resourceInEngagement, resourceEngagementId } from "@/lib/engagement-resources";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const documents = await store.listDocuments(clientId);
    const selected = url.searchParams.get("engagementId");
    if (selected && selected !== "account") await validateResourceEngagement(clientId, selected, undefined, true);
    const tasks = await store.listTasks(clientId);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    return { documents: documents.filter((document) => session.role !== "client" || clientCanSeeDocument(document, tasksById)).filter((document) => resourceInEngagement(document, tasks, selected, url.searchParams.get("includeAccountWide") === "1")).map((document) => documentMetadata({ ...document, engagementId: resourceEngagementId(document, tasks) })) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireSession(req);
    throw jsonError("Upload file contents through /api/documents/upload. Metadata-only file creation is no longer supported.", 400);
  });
}
