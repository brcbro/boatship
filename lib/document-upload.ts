import { randomUUID } from "node:crypto";
import type { ActivityLog, Client, DocumentRecord } from "@/types";

type UploadData = { documents: DocumentRecord[]; clients: Client[]; activity: ActivityLog[] };
export function applyDocumentUpload(data: UploadData, incoming: DocumentRecord, actor: { uid: string; name: string }): DocumentRecord {
  if (!data.clients.some((client) => client.id === incoming.clientId)) throw new Error("Client no longer exists.");
  const existing = data.documents.find((document) => document.id === incoming.id);
  if (existing && existing.clientId !== incoming.clientId) throw new Error("Document ownership does not match.");
  const document = { ...incoming,
    ...(existing ? { documentType: existing.documentType, expiresAt: existing.expiresAt, expiryAlertSentAt: existing.expiryAlertSentAt, taskId: existing.taskId, engagementId: existing.engagementId ?? incoming.engagementId } : {}),
    status: "pending_review" as const, reviewNote: "", versions: existing ? [...existing.versions, {
    storagePath: existing.storagePath, fileName: existing.fileName, uploadedAt: existing.uploadedAt,
    uploadedBy: existing.uploadedBy, contentType: existing.contentType, size: existing.size,
    contentId: existing.contentId ?? null, ...(existing.contentBase64 ? { contentBase64: existing.contentBase64 } : {}),
  }] : [] };
  if (existing) data.documents[data.documents.indexOf(existing)] = document;
  else data.documents.push(document);
  data.activity.push({ id: randomUUID(), clientId: document.clientId, actorId: actor.uid, actorName: actor.name,
    action: existing ? "document.reuploaded" : "document.uploaded", timestamp: document.uploadedAt,
    meta: { documentId: document.id, fileName: document.fileName, engagementId: document.engagementId ?? null },
  });
  return document;
}
