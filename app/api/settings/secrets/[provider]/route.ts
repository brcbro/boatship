import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { deleteUserSecret, WORKSPACE_SECRET_USER_ID } from "@/lib/user-secrets";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const userId = body.userId?.trim() || WORKSPACE_SECRET_USER_ID;
    if (userId !== session.uid && session.role !== "admin") throw jsonError("Forbidden", 403);
    await deleteUserSecret(userId, (await params).provider);
    return { deleted: true };
  });
}
