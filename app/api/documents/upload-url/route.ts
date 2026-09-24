import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      fileName?: string;
      contentType?: string;
      size?: number;
    };

    if (!body.clientId || !body.fileName || !body.contentType) {
      throw jsonError("clientId, fileName, and contentType are required", 400);
    }
    if (!await canAccessClient(session, body.clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(body.clientId);
    if (!client) throw jsonError("Client not found", 404);

    const ext = body.fileName.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_TYPES.has(body.contentType.toLowerCase())) {
      throw jsonError("File type must be pdf, png, jpg, jpeg, or webp", 400);
    }
    if (typeof body.size === "number" && body.size > MAX_BYTES) {
      throw jsonError("File size must be 10MB or less", 400);
    }

    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `clients/${body.clientId}/documents/${Date.now()}_${safeName}`;
    return { storagePath, uploadMode: "database", maxBytes: MAX_BYTES };
  });
}
