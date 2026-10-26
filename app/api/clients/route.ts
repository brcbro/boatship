import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { enqueueIntegrationEvent } from "@/lib/integration-jobs";
import { getStore } from "@/lib/store";
import { dispatchWebhooks } from "@/lib/webhooks";
import { getRedisCacheVersion, redisCacheKey, withRedisCache } from "@/lib/redis-cache";
import { filterAssignedClients } from "@/lib/client-access";
import { CLIENT_STATUSES, PIPELINE_STAGES, clientCreateSchema, isActiveStaffUser, parseClientInput } from "@/lib/client-validation";
import type { ClientStatus, ClientWithProgress, PipelineStage } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const { searchParams } = new URL(req.url);
    if (searchParams.get("view") === "messages") {
      const assignedIds = new Set((await filterAssignedClients(session, await store.listClients())).map((client) => client.id));
      const cacheVersion = await getRedisCacheVersion();
      const cacheKey = await redisCacheKey("clients", `messages-summary:${session.role}:${session.uid}`);
      return withRedisCache(cacheKey, cacheVersion, 30, async () => ({
        clients: (await store.listClientMessageSummaries()).filter((summary) => session.role === "admin" || assignedIds.has(summary.id)),
      }));
    }
    const status = searchParams.get("status") as ClientStatus | null;
    const pipelineStage = searchParams.get("pipelineStage") as PipelineStage | null;
    if (status && !(CLIENT_STATUSES as readonly string[]).includes(status)) throw jsonError(`status must be one of ${CLIENT_STATUSES.join(", ")}`, 400);
    if (pipelineStage && !(PIPELINE_STAGES as readonly string[]).includes(pipelineStage)) throw jsonError(`pipelineStage must be one of ${PIPELINE_STAGES.join(", ")}`, 400);
    const assignedTeamMemberId = searchParams.get("assignedTeamMemberId") || undefined;
    const q = searchParams.get("q") || undefined;
    const tag = searchParams.get("tag") || undefined;

    const filters = { status, pipelineStage, assignedTeamMemberId, q, tag };
    const cacheVersion = await getRedisCacheVersion();
    const cacheKey = await redisCacheKey("clients", JSON.stringify({ ...filters, actor: session.uid, role: session.role }));

    return withRedisCache(cacheKey, cacheVersion, 30, async () => {
      const clients = await filterAssignedClients(session, await store.listClients({
        status: status || undefined,
        pipelineStage: pipelineStage || undefined,
        assignedTeamMemberId,
        q,
        tag,
      }));
      const users = await store.listUsers();
      const userMap = new Map(users.map((u) => [u.uid, u]));

      const result: ClientWithProgress[] = await Promise.all(
        clients.map(async (client) => {
          const progress = await store.clientProgress(client.id);
          const vessels = await store.listVessels(client.id);
          const assignee = client.assignedTeamMemberId
            ? userMap.get(client.assignedTeamMemberId)
            : null;
          return {
            ...client,
            ...progress,
            assignedTeamMemberName: assignee?.name ?? null,
            vesselCount: vessels.length,
          };
        })
      );

      return { clients: result };
    });
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const parsed = parseClientInput(clientCreateSchema, await req.json().catch(() => ({})));
    if (!parsed.ok) throw jsonError(parsed.error, 400);
    const body = parsed.data;

    const tags = body.tags;
    const customFields = body.customFields
      ? Object.fromEntries(
          Object.entries(body.customFields).filter(([k, v]) => k && v)
        )
      : undefined;

    const store = await getStore();
    if (session.role === "team" && body.assignedTeamMemberId !== undefined && body.assignedTeamMemberId !== session.uid) {
      throw jsonError("Forbidden", 403);
    }
    if (body.assignedTeamMemberId && !isActiveStaffUser(await store.getUser(body.assignedTeamMemberId))) {
      throw jsonError("assignedTeamMemberId must be an active team member", 400);
    }
    const client = await store.createClient({
      name: body.name,
      companyName: body.companyName,
      primaryContactEmail: body.primaryContactEmail,
      assignedTeamMemberId: body.assignedTeamMemberId ?? session.uid,
      templateId: body.templateId ?? "seed_standard",
      status: body.status,
      tags,
      customFields,
    });

    const templateId = client.templateId || "seed_standard";
    const tasks = await store.generateTasksFromTemplate(
      client.id,
      templateId,
      client.assignedTeamMemberId
    );

    await store.addActivity({
      clientId: client.id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.created",
      meta: { templateId, taskCount: tasks.length },
    });

    const integrationJobs = await enqueueIntegrationEvent(session.uid, {
      type: "client.created",
      clientId: client.id,
      clientName: client.name,
      companyName: client.companyName,
    }, `client.created:${client.id}`);

    await dispatchWebhooks("client.created", {
      clientId: client.id,
      clientName: client.name,
      companyName: client.companyName,
      primaryContactEmail: client.primaryContactEmail,
    });

    const progress = await store.clientProgress(client.id);
    return { client: { ...client, ...progress }, tasks, integrationJobs: integrationJobs.map(({ id, kind, status }) => ({ id, kind, status })) };
  });
}
