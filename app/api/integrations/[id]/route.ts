import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { disconnectAccount, isComposioConfigured } from "@/lib/composio";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    if (!isComposioConfigured()) {
      throw jsonError("COMPOSIO_API_KEY is not set", 503);
    }
    const { id } = await params;
    if (!id) throw jsonError("connected account id is required", 400);
    await disconnectAccount(id);
    return { ok: true };
  });
}
