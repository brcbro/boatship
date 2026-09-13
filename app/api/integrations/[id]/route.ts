import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { disconnectAccount, isComposioConfiguredForUser } from "@/lib/composio";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!(await isComposioConfiguredForUser(session.uid))) {
      throw jsonError("Composio is not configured for this user or the server", 503);
    }
    const { id } = await params;
    if (!id) throw jsonError("connected account id is required", 400);
    await disconnectAccount(session.uid, id);
    return { ok: true };
  });
}
