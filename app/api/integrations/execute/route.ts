import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { executeTool, isComposioConfigured, isIntegrationTestTool } from "@/lib/composio";

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
    const tool = body.tool.trim();
    if (!isIntegrationTestTool(tool)) {
      throw jsonError("This action is not available from the integrations page", 403);
    }

    const result = await executeTool({
      boatshipUid: session.uid,
      toolSlug: tool,
      arguments: body.arguments || {},
    });

    // Composio returns a successful HTTP response even when the provider tool
    // itself failed (for example, an expired Google connection). Convert that
    // result into an API error so the UI does not claim the action worked.
    if (
      result &&
      typeof result === "object" &&
      (result as { successful?: unknown }).successful === false
    ) {
      const error = (result as { error?: unknown }).error;
      throw jsonError(
        typeof error === "string" && error.trim()
          ? error
          : "The integration could not complete that action. Reconnect it and try again.",
        502
      );
    }

    return { result };
  });
}
