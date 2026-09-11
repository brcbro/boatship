import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const source = await store.getClient(id);
    if (!source) throw jsonError("Client not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      primaryContactEmail?: string;
      name?: string;
      companyName?: string;
    };

    const ts = Date.now();
    const primaryContactEmail = (
      body.primaryContactEmail?.trim() ||
      `${source.primaryContactEmail.replace(/@/, `+clone${ts}@`)}`
    ).toLowerCase();

    if (!primaryContactEmail.includes("@")) {
      throw jsonError("primaryContactEmail is required", 400);
    }

    const templateId = source.templateId || "seed_standard";
    const client = await store.createClient({
      name: body.name?.trim() || `${source.name} (copy)`,
      companyName: body.companyName?.trim() || source.companyName,
      primaryContactEmail,
      assignedTeamMemberId: source.assignedTeamMemberId ?? session.uid,
      templateId,
      tags: [...(source.tags || [])],
      customFields: { ...(source.customFields || {}) },
      pipelineStage: "intake",
      status: "not_started",
    });

    const tasks = await store.generateTasksFromTemplate(
      client.id,
      templateId,
      client.assignedTeamMemberId
    );

    await store.addActivity({
      clientId: client.id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.cloned",
      meta: { sourceClientId: source.id, templateId, taskCount: tasks.length },
    });

    await store.addActivity({
      clientId: source.id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.cloned_from",
      meta: { clonedClientId: client.id },
    });

    const progress = await store.clientProgress(client.id);
    return { client: { ...client, ...progress }, tasks };
  });
}
