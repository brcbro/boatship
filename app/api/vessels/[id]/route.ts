import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { Vessel } from "@/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!isStaff(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getVessel(id);
    if (!existing) throw jsonError("Vessel not found", 404);
    if (!await canAccessClient(session, existing.clientId)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      imo?: string;
      flag?: string;
      vesselType?: string;
      classSociety?: string;
      notes?: string;
    };

    const vessel: Vessel = {
      ...existing,
      name: body.name !== undefined ? body.name.trim() : existing.name,
      imo: body.imo !== undefined ? body.imo.trim() : existing.imo,
      flag: body.flag !== undefined ? body.flag.trim() : existing.flag,
      vesselType:
        body.vesselType !== undefined ? body.vesselType.trim() : existing.vesselType,
      classSociety:
        body.classSociety !== undefined
          ? body.classSociety.trim()
          : existing.classSociety,
      notes: body.notes !== undefined ? body.notes.trim() : existing.notes,
      updatedAt: new Date().toISOString(),
    };

    if (!vessel.name) throw jsonError("name is required", 400);

    await store.upsertVessel(vessel);

    await store.addActivity({
      clientId: vessel.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "vessel.updated",
      meta: { vesselId: vessel.id, name: vessel.name },
    });

    return { vessel };
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!isStaff(session.role)) throw jsonError("Forbidden", 403);

    const { id } = await params;
    const store = await getStore();
    const existing = await store.getVessel(id);
    if (!existing) throw jsonError("Vessel not found", 404);
    if (!await canAccessClient(session, existing.clientId)) throw jsonError("Forbidden", 403);

    await store.deleteVessel(id);

    await store.addActivity({
      clientId: existing.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "vessel.deleted",
      meta: { vesselId: existing.id, name: existing.name },
    });

    return { ok: true };
  });
}
