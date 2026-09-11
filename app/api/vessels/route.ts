import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient, isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { Vessel } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);

    const store = await getStore();
    const client = await store.getClient(clientId);
    if (!client) throw jsonError("Client not found", 404);

    const vessels = await store.listVessels(clientId);
    return { vessels };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!isStaff(session.role)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      clientId?: string;
      name?: string;
      imo?: string;
      flag?: string;
      vesselType?: string;
      classSociety?: string;
      notes?: string;
    };

    if (!body.clientId?.trim()) throw jsonError("clientId is required", 400);
    if (!body.name?.trim()) throw jsonError("name is required", 400);

    const store = await getStore();
    const client = await store.getClient(body.clientId);
    if (!client) throw jsonError("Client not found", 404);

    const now = new Date().toISOString();
    const vessel: Vessel = {
      id: randomUUID(),
      clientId: body.clientId,
      name: body.name.trim(),
      imo: body.imo?.trim() || "",
      flag: body.flag?.trim() || "",
      vesselType: body.vesselType?.trim() || "",
      classSociety: body.classSociety?.trim() || "",
      notes: body.notes?.trim() || "",
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertVessel(vessel);

    await store.addActivity({
      clientId: body.clientId,
      actorId: session.uid,
      actorName: session.name,
      action: "vessel.created",
      meta: { vesselId: vessel.id, name: vessel.name },
    });

    return { vessel };
  });
}
