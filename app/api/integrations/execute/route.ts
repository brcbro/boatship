import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { executeTool, isComposioConfigured } from "@/lib/composio";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!isComposioConfigured()) {
      throw jsonError("COMPOSIO_API_KEY is not set", 503);
    }

    const body = (await req.json().catch(() => ({}))) as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };

    if (!body.tool?.trim()) throw jsonError("tool is required", 400);

    const result = await executeTool({
      boatshipUid: session.uid,
      toolSlug: body.tool.trim(),
      arguments: body.arguments || {},
    });

    return { result };
  });
}
