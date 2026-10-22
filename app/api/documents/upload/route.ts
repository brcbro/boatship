import { randomUUID } from "node:crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";
import { decodeDocumentUpload, DocumentInputError, DOCUMENT_MAX_BYTES } from "@/lib/document-files";
import { saveDocumentContent, removeUnreferencedDocumentContent } from "@/lib/document-content";
import { validateResourceEngagement } from "@/lib/engagement-resources";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    if (Number(req.headers.get("content-length")) > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4 + 8192) throw jsonError("File size must be 10MB or less", 413);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw jsonError("Provide a valid file upload.", 400);
    if (typeof body.clientId !== "string" || !body.clientId.trim()) throw jsonError("clientId is required", 400);
    const clientId = body.clientId.trim();
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    const store = await getStore();
    if (!await store.getClient(clientId)) throw jsonError("Client not found", 404);
    const existing = typeof body.documentId === "string" ? await store.getDocument(body.documentId) : null;
    if (body.documentId && !existing) throw jsonError("Document not found", 404);
    if (existing && existing.clientId !== clientId) throw jsonError("Forbidden", 403);
    const taskId = existing?.taskId ?? body.taskId ?? null;
    if (typeof taskId === "string" && session.role === "client" && (await store.getTask(taskId))?.type !== "client_facing") throw jsonError("Forbidden", 403);
    const engagementId = await validateResourceEngagement(clientId, existing?.engagementId ?? body.engagementId, taskId);
    let file;
    try { file = decodeDocumentUpload({ base64: body.base64, fileName: body.fileName, contentType: body.contentType, size: body.size }); }
    catch (error) { if (error instanceof DocumentInputError) throw jsonError(error.message, 400); throw error; }
    const id = existing?.id || randomUUID();
    const contentId = await saveDocumentContent(id, clientId, file.bytes, file.contentType);
    let document;
    try {
      document = await store.persistDocumentUpload({
        id, clientId, taskId: typeof taskId === "string" ? taskId : null, engagementId,
        fileName: file.fileName, contentType: file.contentType, size: file.bytes.length,
        storagePath: `db://document-content/${contentId}`, contentId, contentBase64: null,
        uploadedBy: session.uid, uploadedAt: new Date().toISOString(), status: "pending_review", reviewNote: "",
        documentType: existing?.documentType ?? null, expiresAt: existing?.expiresAt ?? null,
        expiryAlertSentAt: null, versions: [],
      }, { uid: session.uid, name: session.name });
    } catch (error) {
      await removeUnreferencedDocumentContent(contentId).catch((cleanupError) => console.error("Document upload cleanup failed", cleanupError));
      throw error;
    }
    return { document: documentMetadata(document) };
  });
}
