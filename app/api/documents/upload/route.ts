import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      taskId?: string | null;
      documentId?: string;
      fileName?: string;
      contentType?: string;
      size?: number;
      base64?: string;
      storagePath?: string;
    };

    if (
      !body.clientId ||
      !body.fileName ||
      !body.contentType ||
      !body.base64 ||
      !body.storagePath
    ) {
      throw jsonError(
        "clientId, fileName, contentType, base64, and storagePath are required",
        400
      );
    }
    if (!await canAccessClient(session, body.clientId)) throw jsonError("Forbidden", 403);

    if (!ALLOWED_TYPES.has(body.contentType.toLowerCase())) {
      throw jsonError("File type must be pdf, png, jpg, jpeg, or webp", 400);
    }

    // Strip data-URL prefix if present
    const raw = body.base64.includes(",") ? body.base64.split(",")[1]! : body.base64;
    const buffer = Buffer.from(raw, "base64");
    const size = body.size ?? buffer.byteLength;
    if (size > MAX_BYTES || buffer.byteLength > MAX_BYTES) {
      throw jsonError("File size must be 10MB or less", 400);
    }

    // Prevent path traversal (keep POSIX-style keys; Windows normalize would break checks)
    const normalized = body.storagePath.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "");
    if (
      normalized.includes("..") ||
      normalized.startsWith("/") ||
      /^[a-zA-Z]:/.test(normalized)
    ) {
      throw jsonError("Invalid storagePath", 400);
    }
    if (!normalized.startsWith(`clients/${body.clientId}/`)) {
      throw jsonError("storagePath must be under the client documents folder", 400);
    }

    const store = await getStore();
    const storagePath = `db://${normalized}`;

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
        contentBase64: existing.contentBase64 ?? null,
      };
      const uploadedAt = new Date().toISOString();
      const document = await store.updateDocument(body.documentId, {
        fileName: body.fileName,
        storagePath,
        contentType: body.contentType,
        size: buffer.byteLength,
        versions: [...(existing.versions || []), previous],
        status: "pending_review",
        reviewNote: "",
        uploadedAt,
        uploadedBy: session.uid,
        contentBase64: raw,
      });

      await store.addActivity({
        clientId: body.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.reuploaded",
        meta: { documentId: document.id, fileName: document.fileName, mode: "local" },
      });

      return { document: documentMetadata(document) };
    }

    const document = await store.createDocument({
      clientId: body.clientId,
      taskId: body.taskId ?? null,
      fileName: body.fileName,
      storagePath,
      uploadedBy: session.uid,
      contentType: body.contentType,
      size: buffer.byteLength,
      contentBase64: raw,
    });

    await store.addActivity({
      clientId: body.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "document.uploaded",
      meta: { documentId: document.id, fileName: document.fileName, mode: "local" },
    });

    return { document: documentMetadata(document) };
  });
}
