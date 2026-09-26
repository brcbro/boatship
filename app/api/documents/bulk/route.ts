import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { dispatchWebhooks } from "@/lib/webhooks";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { documentMetadata } from "@/lib/document-response";
import type { DocumentStatus } from "@/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      status?: DocumentStatus;
      reviewNote?: string;
    };

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!ids.length) throw jsonError("ids is required", 400);

    if (
      !body.status ||
      !["approved", "rejected", "pending_review"].includes(body.status)
    ) {
      throw jsonError("status must be approved, rejected, or pending_review", 400);
    }

    const store = await getStore();
    const updated = [];
    const missing: string[] = [];

    for (const id of ids) {
      const existing = await store.getDocument(id);
      if (!existing) {
        missing.push(id);
        continue;
      }
      if (!await canAccessClient(session, existing.clientId)) throw jsonError("Forbidden", 403);

      const patch: { status: DocumentStatus; reviewNote?: string } = {
        status: body.status,
      };
      if (body.reviewNote !== undefined) patch.reviewNote = body.reviewNote;

      const document = await store.updateDocument(id, patch);
      updated.push(document);

      await store.addActivity({
        clientId: existing.clientId,
        actorId: session.uid,
        actorName: session.name,
        action: "document.reviewed",
        meta: {
          documentId: id,
          status: body.status,
          reviewNote: body.reviewNote,
          bulk: true,
        },
      });

      if (body.status === "approved" || body.status === "rejected") {
        const client = await store.getClient(existing.clientId);
        await dispatchWebhooks(
          body.status === "approved" ? "document.approved" : "document.rejected",
          {
            documentId: document.id,
            fileName: document.fileName,
            clientId: existing.clientId,
            clientName: client?.name ?? null,
            companyName: client?.companyName ?? null,
            status: body.status,
            reviewNote: body.reviewNote ?? document.reviewNote,
          }
        );
      }
    }

    return {
      documents: updated.map(documentMetadata),
      updated: updated.length,
      missing,
    };
  });
}
