import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GDPR right-to-erasure — permanently deletes a client and related records.
 * Admin only. Requires confirm: true.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      confirm?: boolean;
    };

    const clientId = (body.clientId || "").trim();
    if (!clientId) throw jsonError("clientId is required", 400);
    if (body.confirm !== true) {
      throw jsonError("confirm must be true to delete client data", 400);
    }

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const snapshot = {
      clientId: client.id,
      companyName: client.companyName,
      name: client.name,
    };

    await store.deleteClientCascade(clientId);

    // Activity for this client is removed by cascade; return ok with audit snapshot.
    return {
      ok: true,
      deleted: snapshot,
      deletedBy: { uid: session.uid, name: session.name, email: session.email },
      deletedAt: new Date().toISOString(),
    };
  });
}
