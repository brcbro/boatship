import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { documentReviewedEmailHtml, sendEmail } from "@/lib/email";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";
import { documentMetadata } from "@/lib/document-response";
import { clientCanSeeTask } from "@/lib/client-projection";
import { dispatchWebhooks } from "@/lib/webhooks";
import type { DocumentStatus } from "@/types";
import { validateResourceEngagement } from "@/lib/engagement-resources";

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
    if (session.role === "client" && document.taskId && !clientCanSeeTask(await store.getTask(document.taskId))) {
      throw jsonError("Document not found", 404);
    }
    return { document: documentMetadata(document) };
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
    await validateResourceEngagement(existing.clientId, existing.engagementId, existing.taskId);

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

    const isReplacingFile = ["fileName", "storagePath", "contentType", "size", "contentBase64", "contentId", "versions"].some((key) => Object.hasOwn(body, key));

    if (isReplacingFile) throw jsonError("Replace files through /api/documents/upload so their contents and history remain consistent.", 400);

    // File content changes use the validated upload route.
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
      body.status === undefined &&
      body.reviewNote === undefined &&
      body.documentType === undefined &&
      body.expiresAt === undefined
    ) {
      throw jsonError(
        "Provide status, reviewNote, documentType, or expiresAt to update",
        400
      );
    }

    if (
      body.status !== undefined &&
      !["approved", "rejected", "pending_review"].includes(body.status)
    ) {
      throw jsonError("status must be approved, rejected, or pending_review", 400);
    }
    if (body.reviewNote !== undefined && (typeof body.reviewNote !== "string" || body.reviewNote.length > 10000)) throw jsonError("Enter a review note of at most 10000 characters.", 400);
    if (body.documentType !== undefined && body.documentType !== null && (typeof body.documentType !== "string" || body.documentType.length > 100)) throw jsonError("Enter a document type of at most 100 characters.", 400);
    if (body.expiresAt !== undefined && body.expiresAt !== null && (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt)))) throw jsonError("Choose a valid expiry date.", 400);

    const patch: Partial<typeof existing> = {};

    if (body.reviewNote !== undefined) patch.reviewNote = body.reviewNote;
    if (body.documentType !== undefined) patch.documentType = body.documentType;
    if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt;

    if (body.status !== undefined) patch.status = body.status;

    const document = await store.updateDocument(id, patch);

    if (body.status !== undefined) {
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
