import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { clientCanSeeTask } from "@/lib/client-projection";
import { getStore } from "@/lib/store";
import { withRequestStoreScope } from "@/lib/store-context";
import { internalErrorResponse, jsonError } from "@/lib/api";
import { readDocumentContentRange } from "@/lib/document-content";
import { DocumentInputError, documentContentHeaders, documentVersionIndex, sniffDocumentType } from "@/lib/document-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withRequestStoreScope(async () => {
      const session = await requireSession(req);
      const { id } = await params;
      const store = await getStore();
      const document = await store.getDocument(id);
      if (!document) return jsonError("Document not found", 404);
      if (!await canAccessClient(session, document.clientId)) return jsonError("Forbidden", 403);
      if (session.role === "client" && document.taskId && !clientCanSeeTask(await store.getTask(document.taskId))) {
        return jsonError("Document not found", 404);
      }
      const url = new URL(req.url);
      const index = documentVersionIndex(url.searchParams.get("version"), document.versions.length);
      const version = index === null ? document : document.versions[index];
      // Range requests read only the requested bytes when the store supports it.
      const read = await readDocumentContentRange(document, version, req.headers.get("range"));
      if (!read) return jsonError("This file is unavailable. Ask your team to upload it again.", 404);
      if (read.kind === "unsatisfiable") {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${read.size}`, "Cache-Control": "private, no-store" } });
      }
      const type = sniffDocumentType(read.head) || "application/octet-stream";
      const headers = documentContentHeaders(version.fileName, type, url.searchParams.get("disposition") === "attachment" || type === "application/octet-stream");
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(read.bytes.length));
      if (read.kind === "partial" && read.range) {
        headers.set("Content-Range", `bytes ${read.range.start}-${read.range.end}/${read.size}`);
        return new Response(new Uint8Array(read.bytes), { status: 206, headers });
      }
      return new Response(read.bytes as Uint8Array<ArrayBuffer>, { headers });
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof DocumentInputError) return jsonError(error.message, 400);
    return internalErrorResponse(error);
  }
}
