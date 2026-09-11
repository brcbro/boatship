import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const form = await store.getForm(id);
    if (!form) throw jsonError("Form not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      reviewNote?: string;
      status?: "reviewed";
    };

    const updated = await store.updateForm(id, {
      status: "reviewed",
      reviewedAt: new Date().toISOString(),
      reviewNote: body.reviewNote ?? form.reviewNote,
    });

    await store.addActivity({
      clientId: form.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "form.reviewed",
      meta: { formId: id, reviewNote: body.reviewNote },
    });

    return { form: updated };
  });
}
