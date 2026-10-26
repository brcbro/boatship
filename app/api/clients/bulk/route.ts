import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { clientBulkSchema, isActiveStaffUser, parseClientInput } from "@/lib/client-validation";
import type { ClientStatus } from "@/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const parsed = parseClientInput(clientBulkSchema, await req.json().catch(() => ({})));
    if (!parsed.ok) throw jsonError(parsed.error, 400);
    const body = parsed.data;
    const ids = body.ids;
    if (session.role === "team") {
      for (const id of ids) if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
      if (body.assignedTeamMemberId !== undefined && body.assignedTeamMemberId !== session.uid) throw jsonError("Forbidden", 403);
    }

    const store = await getStore();
    if (body.assignedTeamMemberId && !isActiveStaffUser(await store.getUser(body.assignedTeamMemberId))) {
      throw jsonError("assignedTeamMemberId must be an active team member", 400);
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
    if (body.tags !== undefined) patch.tags = body.tags;

    if (!Object.keys(patch).length) {
      throw jsonError("Provide status, assignedTeamMemberId, and/or tags", 400);
    }

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
