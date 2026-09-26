import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!await canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const documents = await store.listDocuments(clientId);
    return { documents: documents.map(documentMetadata) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      taskId?: string | null;
      documentId?: string;
      fileName?: string;
      storagePath?: string;
      contentType?: string;
      size?: number;
      documentType?: string | null;
      expiresAt?: string | null;
    };

    if (!body.clientId || !body.fileName || !body.storagePath || !body.contentType) {
      throw jsonError("clientId, fileName, storagePath, and contentType are required", 400);
    }
    if (!await canAccessClient(session, body.clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(body.clientId);
    if (!client) throw jsonError("Client not found", 404);

    if (body.documentId) {
      const existing = await store.getDocument(body.documentId);
      if (!existing) throw jsonError("Document not found", 404);
      if (existing.clientId !== body.clientId) throw jsonError("Forbidden", 403);

      const previous = {
        storagePath: existing.storagePath,
        fileName: existing.fileName,
        uploadedAt: existing.uploadedAt,
        uploadedBy: existing.uploadedBy,
        contentType: existing.contentType,
        size: existing.size,
      };
      const uploadedAt = new Date().toISOString();
      const document = await store.updateDocument(body.documentId, {
        fileName: body.fileName,
        storagePath: body.storagePath,
        contentType: body.contentType,
        size: body.size ?? 0,
        versions: [...(existing.versions || []), previous],
        status: "pending_review",
        reviewNote: "",
        uploadedAt,
        uploadedBy: session.uid,
        ...(body.documentType !== undefined ? { documentType: body.documentType } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      });

      await store.addActivity({
        clientId: body.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.reuploaded",
        meta: { documentId: document.id, fileName: document.fileName },
      });

      return { document: documentMetadata(document) };
    }

    const document = await store.createDocument({
      clientId: body.clientId,
      taskId: body.taskId ?? null,
      fileName: body.fileName,
      storagePath: body.storagePath,
      uploadedBy: session.uid,
      contentType: body.contentType,
      size: body.size ?? 0,
      documentType: body.documentType ?? null,
      expiresAt: body.expiresAt ?? null,
    });

    await store.addActivity({
      clientId: body.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "document.uploaded",
      meta: { documentId: document.id, fileName: document.fileName },
    });

    return { document: documentMetadata(document) };
  });
}
