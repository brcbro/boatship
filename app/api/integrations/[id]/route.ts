import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { ConnectedAccountNotOwnedError, disconnectAccount, isComposioConfiguredForUser } from "@/lib/composio";
import { requireStaffPermission } from "@/lib/rbac";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    requireStaffPermission(session, "integrations.manage");
    if (!(await isComposioConfiguredForUser(session.uid))) {
      throw jsonError("Composio is not configured for this user or the server", 503);
    }
    const { id } = await params;
    if (!id?.trim()) throw jsonError("connected account id is required", 400);
    try {
      // Only an account listed under the caller's own Composio user is deleted.
      await disconnectAccount(session.uid, id.trim());
    } catch (error) {
      if (error instanceof ConnectedAccountNotOwnedError) throw jsonError("Connected account not found", 404);
      throw error;
    }
    return { ok: true };
  });
}
