import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GDPR data export for a client — JSON dump of account data (no binary file contents).
 */
export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const [tasks, documents, forms, messages, vessels, activity] = await Promise.all([
      store.listTasks(clientId),
      store.listDocuments(clientId),
      store.listForms(clientId),
      store.listMessages(clientId),
      store.listVessels(clientId),
      store.listActivity(clientId),
    ]);

    // Document metadata only — omit storage payloads / binary content.
    const documentsMeta = documents.map((d) => ({
      id: d.id,
      clientId: d.clientId,
      taskId: d.taskId,
      fileName: d.fileName,
      status: d.status,
      reviewNote: d.reviewNote,
      uploadedBy: d.uploadedBy,
      uploadedAt: d.uploadedAt,
      contentType: d.contentType,
      size: d.size,
      documentType: d.documentType,
      expiresAt: d.expiresAt,
      versionCount: d.versions?.length ?? 0,
      versions: (d.versions || []).map((v) => ({
        fileName: v.fileName,
        uploadedAt: v.uploadedAt,
        uploadedBy: v.uploadedBy,
        contentType: v.contentType,
        size: v.size,
      })),
    }));

    return {
      exportedAt: new Date().toISOString(),
      client,
      tasks,
      documents: documentsMeta,
      forms,
      messages,
      vessels,
      activity,
    };
  });
}
