import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { clientUpdateSchema, isActiveStaffUser, parseClientInput } from "@/lib/client-validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    if (!await canAccessClient(session, id)) {
      throw jsonError("Forbidden", 403);
    }

    const store = await getStore();
    const client = await store.getClient(id);
    if (!client) throw jsonError("Client not found", 404);

    const progress = await store.clientProgress(id);
    let assignedTeamMemberName: string | null = null;
    if (client.assignedTeamMemberId) {
      const user = await store.getUser(client.assignedTeamMemberId);
      assignedTeamMemberName = user?.name ?? null;
    }

    return {
      client: {
        ...client,
        ...progress,
        assignedTeamMemberName,
      },
    };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const existing = await store.getClient(id);
    if (!existing) throw jsonError("Client not found", 404);
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);

    const parsed = parseClientInput(clientUpdateSchema, await req.json().catch(() => ({})));
    if (!parsed.ok) throw jsonError(parsed.error, 400);
    const body = parsed.data;

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.companyName !== undefined) patch.companyName = body.companyName;
    if (body.primaryContactEmail !== undefined) patch.primaryContactEmail = body.primaryContactEmail;
    if (body.status !== undefined) patch.status = body.status;
    if (body.assignedTeamMemberId !== undefined) {
      if (session.role === "team" && body.assignedTeamMemberId !== session.uid) throw jsonError("Forbidden", 403);
      if (body.assignedTeamMemberId !== null && !isActiveStaffUser(await store.getUser(body.assignedTeamMemberId))) {
        throw jsonError("assignedTeamMemberId must be an active team member", 400);
      }
      patch.assignedTeamMemberId = body.assignedTeamMemberId;
    }
    if (body.templateId !== undefined) patch.templateId = body.templateId;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.customFields !== undefined) {
      patch.customFields = Object.fromEntries(Object.entries(body.customFields).filter(([k]) => k));
    }
    if (body.pipelineStage !== undefined) patch.pipelineStage = body.pipelineStage;

    // Explicit pause/resume helpers
    if (body.paused === true) {
      const reason = (body.pauseReason ?? existing.pauseReason ?? "").toString().trim();
      if (!reason) throw jsonError("pauseReason is required when pausing", 400);
      patch.pauseReason = reason;
      patch.pausedAt = body.pausedAt || new Date().toISOString();
      if (body.status === undefined) patch.status = "on_hold";
    } else if (body.paused === false) {
      patch.pauseReason = null;
      patch.pausedAt = null;
      if (body.status === undefined && existing.status === "on_hold") {
        patch.status = "in_progress";
      }
    } else {
      if (body.pauseReason !== undefined) {
        patch.pauseReason =
          body.pauseReason === null || body.pauseReason === ""
            ? null
            : String(body.pauseReason).trim();
      }
      if (body.pausedAt !== undefined) {
        patch.pausedAt = body.pausedAt;
      }
    }

    if (!isStaff(session.role)) {
      throw jsonError("Forbidden", 403);
    }

    const client = await store.updateClient(id, patch);

    await store.addActivity({
      clientId: id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.updated",
      meta: { patch },
    });

    const progress = await store.clientProgress(id);
    return { client: { ...client, ...progress } };
  });
}
