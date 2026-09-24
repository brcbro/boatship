import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { notifyIntegrations } from "@/lib/composio";
import { provisionClientDriveFolder } from "@/lib/drive-provision";
import { getStore } from "@/lib/store";
import { dispatchWebhooks } from "@/lib/webhooks";
import { getRedisCacheVersion, redisCacheKey, withRedisCache } from "@/lib/redis-cache";
import { filterAssignedClients } from "@/lib/client-access";
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
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      companyName?: string;
      primaryContactEmail?: string;
      assignedTeamMemberId?: string | null;
      templateId?: string | null;
      status?: ClientStatus;
      tags?: string[];
      customFields?: Record<string, string>;
    };

    if (!body.name?.trim() || !body.companyName?.trim() || !body.primaryContactEmail?.trim()) {
      throw jsonError("name, companyName, and primaryContactEmail are required", 400);
    }

    const tags = Array.isArray(body.tags)
      ? body.tags.map((t) => String(t).trim()).filter(Boolean)
      : undefined;
    const customFields =
      body.customFields && typeof body.customFields === "object"
        ? Object.fromEntries(
            Object.entries(body.customFields)
              .map(([k, v]) => [k.trim(), String(v ?? "").trim()])
              .filter(([k, v]) => k && v)
          )
        : undefined;

    const store = await getStore();
    if (session.role === "team" && body.assignedTeamMemberId !== undefined && body.assignedTeamMemberId !== session.uid) {
      throw jsonError("Forbidden", 403);
    }
    const client = await store.createClient({
      name: body.name.trim(),
      companyName: body.companyName.trim(),
      primaryContactEmail: body.primaryContactEmail.trim().toLowerCase(),
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

    void notifyIntegrations(session.uid, {
      type: "client.created",
      clientId: client.id,
      clientName: client.name,
      companyName: client.companyName,
    });

    void dispatchWebhooks("client.created", {
      clientId: client.id,
      clientName: client.name,
      companyName: client.companyName,
      primaryContactEmail: client.primaryContactEmail,
    });

    // Soft Drive folder provision — never blocks client creation.
    void (async () => {
      const folder = await provisionClientDriveFolder(session.uid, client);
      if (!folder) return;
      try {
        await store.addActivity({
          clientId: client.id,
          actorId: session.uid,
          actorName: session.name,
          action: "client.drive_folder",
          meta: {
            folderId: folder.folderId,
            folderUrl: folder.folderUrl,
            folderName: folder.folderName,
          },
        });
      } catch (err) {
        console.error("[clients] drive folder activity failed", err);
      }
    })();

    const progress = await store.clientProgress(client.id);
    return { client: { ...client, ...progress }, tasks };
  });
}
