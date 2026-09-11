import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { ClientStatus, PipelineStage, SavedSmartList } from "@/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const smartLists = await store.listSmartLists(session.uid);
    return {
      smartLists: [...smartLists].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      filter?: {
        status?: ClientStatus | null;
        tag?: string | null;
        assignedTeamMemberId?: string | null;
        pipelineStage?: PipelineStage | null;
        q?: string | null;
      };
    };

    if (!body.name?.trim()) throw jsonError("name is required", 400);

    const filter = body.filter || {};
    const list: SavedSmartList = {
      id: randomUUID(),
      ownerId: session.uid,
      name: body.name.trim(),
      filter: {
        status: filter.status ?? null,
        tag: filter.tag ?? null,
        assignedTeamMemberId: filter.assignedTeamMemberId ?? null,
        pipelineStage: filter.pipelineStage ?? null,
        q: filter.q ?? null,
      },
      createdAt: new Date().toISOString(),
    };

    const store = await getStore();
    await store.upsertSmartList(list);
    return { smartList: list };
  });
}
