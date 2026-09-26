import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { documentReviewedEmailHtml, sendEmail } from "@/lib/email";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";
import { dispatchWebhooks } from "@/lib/webhooks";
import type { DocumentStatus, DocumentVersion } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const document = await store.getDocument(id);
    if (!document) throw jsonError("Document not found", 404);
    if (!await canAccessClient(session, document.clientId)) {
      throw jsonError("Forbidden", 403);
    }
    return { document };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getDocument(id);
    if (!existing) throw jsonError("Document not found", 404);
    if (!await canAccessClient(session, existing.clientId)) {
      throw jsonError("Forbidden", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      status?: DocumentStatus;
      reviewNote?: string;
      documentType?: string | null;
      expiresAt?: string | null;
      fileName?: string;
      storagePath?: string;
      contentType?: string;
      size?: number;
    };

    const isReplacingFile =
      typeof body.fileName === "string" ||
      typeof body.storagePath === "string" ||
      typeof body.contentType === "string" ||
      typeof body.size === "number";

    // Staff-only review / metadata fields (clients may re-upload file fields)
    const wantsReviewOrMeta =
      body.status !== undefined ||
      body.reviewNote !== undefined ||
      body.documentType !== undefined ||
      body.expiresAt !== undefined;

    if (wantsReviewOrMeta && session.role === "client") {
      throw jsonError("Forbidden", 403);
    }

    if (session.role !== "client") {
      await requireRoles(req, ["admin", "team"]);
    }

    if (
      !isReplacingFile &&
      body.status === undefined &&
      body.reviewNote === undefined &&
      body.documentType === undefined &&
      body.expiresAt === undefined
    ) {
      throw jsonError(
        "Provide status, reviewNote, documentType, expiresAt, and/or file fields to update",
        400
      );
    }

    if (
      body.status !== undefined &&
      !["approved", "rejected", "pending_review"].includes(body.status)
    ) {
      throw jsonError("status must be approved, rejected, or pending_review", 400);
    }

    const patch: Partial<typeof existing> = {};

    if (body.reviewNote !== undefined) patch.reviewNote = body.reviewNote;
    if (body.documentType !== undefined) patch.documentType = body.documentType;
    if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt;

    if (isReplacingFile) {
      if (!body.fileName || !body.storagePath || !body.contentType) {
        throw jsonError(
          "fileName, storagePath, and contentType are required when replacing a file",
          400
        );
      }

      const previous: DocumentVersion = {
        storagePath: existing.storagePath,
        fileName: existing.fileName,
        uploadedAt: existing.uploadedAt,
        uploadedBy: existing.uploadedBy,
        contentType: existing.contentType,
        size: existing.size,
      };

      const versions = [...(existing.versions || []), previous];
      const uploadedAt = new Date().toISOString();

      patch.fileName = body.fileName;
      patch.storagePath = body.storagePath;
      patch.contentType = body.contentType;
      patch.size = body.size ?? existing.size;
      patch.versions = versions;
      patch.status = "pending_review";
      patch.uploadedAt = uploadedAt;
      patch.uploadedBy = session.uid;
      if (body.reviewNote === undefined) patch.reviewNote = "";
    } else if (body.status !== undefined) {
      patch.status = body.status;
    }

    const document = await store.updateDocument(id, patch);

    if (isReplacingFile) {
      await store.addActivity({
        clientId: existing.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.reuploaded",
        meta: {
          documentId: id,
          fileName: document.fileName,
          versionCount: document.versions?.length ?? 0,
        },
      });
    } else if (body.status !== undefined) {
      await store.addActivity({
        clientId: existing.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.reviewed",
        meta: { documentId: id, status: body.status, reviewNote: body.reviewNote },
      });

      const client = await store.getClient(existing.clientId);
      if (client && (body.status === "approved" || body.status === "rejected")) {
        try {
          await sendEmail({
            to: client.primaryContactEmail,
            subject: `Document ${body.status}: ${existing.fileName}`,
            html: documentReviewedEmailHtml({
              name: client.name,
              fileName: existing.fileName,
              status: body.status,
              note: body.reviewNote,
              link: `${appBaseUrl(req)}/portal`,
            }),
          });
        } catch (err) {
          console.error("Failed to send document review email", err);
        }

        await dispatchWebhooks(
          body.status === "approved" ? "document.approved" : "document.rejected",
          {
            documentId: document.id,
            fileName: document.fileName,
            clientId: existing.clientId,
            clientName: client.name,
            companyName: client.companyName,
            status: body.status,
            reviewNote: body.reviewNote ?? document.reviewNote,
          }
        );
      }
    } else {
      await store.addActivity({
        clientId: existing.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.updated",
        meta: {
          documentId: id,
          documentType: body.documentType,
          expiresAt: body.expiresAt,
        },
      });
    }

    return { document: documentMetadata(document) };
  });
}
