import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const lists = await store.listSmartLists(session.uid);
    const existing = lists.find((l) => l.id === id);
    if (!existing) throw jsonError("Smart list not found", 404);

    await store.deleteSmartList(id);
    return { ok: true };
  });
}
