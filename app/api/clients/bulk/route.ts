import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import type { ClientStatus } from "@/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      status?: ClientStatus;
      assignedTeamMemberId?: string | null;
      tags?: string[];
    };

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!ids.length) throw jsonError("ids is required", 400);
    if (session.role === "team") {
      for (const id of ids) if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
      if (body.assignedTeamMemberId !== undefined && body.assignedTeamMemberId !== session.uid) throw jsonError("Forbidden", 403);
    }

    const patch: {
      status?: ClientStatus;
      assignedTeamMemberId?: string | null;
      tags?: string[];
    } = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.assignedTeamMemberId !== undefined) {
      patch.assignedTeamMemberId = body.assignedTeamMemberId;
    }
    if (body.tags !== undefined) {
      patch.tags = Array.isArray(body.tags)
        ? body.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
    }

    if (!Object.keys(patch).length) {
      throw jsonError("Provide status, assignedTeamMemberId, and/or tags", 400);
    }

    const store = await getStore();
    const clients = await store.bulkUpdateClients(ids, patch);

    await Promise.all(
      clients.map((client) =>
        store.addActivity({
          clientId: client.id,
          actorId: session.uid,
          actorName: session.name,
          action: "client.bulk_updated",
          meta: { patch },
        })
      )
    );

    return { clients, updated: clients.length };
  });
}
