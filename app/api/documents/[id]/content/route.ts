import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { clientCanSeeTask } from "@/lib/client-projection";
import { getStore } from "@/lib/store";
import { withRequestStoreScope } from "@/lib/store-context";
import { internalErrorResponse, jsonError } from "@/lib/api";
import { readDocumentContent } from "@/lib/document-content";
import { DocumentInputError, documentByteRange, documentContentHeaders, documentVersionIndex, sniffDocumentType } from "@/lib/document-files";

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
      const bytes = await readDocumentContent(document, version);
      if (!bytes?.length) return jsonError("This file is unavailable. Ask your team to upload it again.", 404);
      const type = sniffDocumentType(bytes) || "application/octet-stream";
      const headers = documentContentHeaders(version.fileName, type, url.searchParams.get("disposition") === "attachment" || type === "application/octet-stream");
      headers.set("Accept-Ranges", "bytes");
      let range;
      try { range = documentByteRange(req.headers.get("range"), bytes.length); }
      catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}`, "Cache-Control": "private, no-store" } }); }
      if (range) {
        const body = bytes.slice(range.start, range.end + 1);
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${bytes.length}`);
        headers.set("Content-Length", String(body.length));
        return new Response(body, { status: 206, headers });
      }
      headers.set("Content-Length", String(bytes.length));
      return new Response(Uint8Array.from(bytes), { headers });
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof DocumentInputError) return jsonError(error.message, 400);
    return internalErrorResponse(error);
  }
}
