import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { executeTool, integrationTestArguments, isComposioConfiguredForUser } from "@/lib/composio";
import { integrationProviderConfirmed } from "@/lib/integration-job-policy";
import { requireStaffPermission } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * Connection tests for the integrations page. The server fixes the arguments
 * of each test, so this endpoint cannot send arbitrary content; only the Slack
 * channel is chosen by the caller.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    requireStaffPermission(session, "integrations.manage");
    if (!(await isComposioConfiguredForUser(session.uid))) {
      throw jsonError("Composio is not configured for this user or the server", 503);
    }

    const body = (await req.json().catch(() => ({}))) as { tool?: unknown; channel?: unknown };
    const tool = typeof body.tool === "string" ? body.tool.trim() : "";
    if (!tool) throw jsonError("tool is required", 400);

    let args: Record<string, unknown> | null;
    try {
      args = integrationTestArguments(tool, { channel: body.channel });
    } catch (error) {
      throw jsonError(error instanceof Error ? error.message : "Invalid test input", 400);
    }
    if (!args) throw jsonError("This action is not available from the integrations page", 403);

    const result = await executeTool({ boatshipUid: session.uid, toolSlug: tool, arguments: args });

    // Composio returns a successful HTTP response even when the provider tool
    // itself failed (for example, an expired Google connection). Convert that
    // result into an API error so the UI does not claim the action worked.
    if (!integrationProviderConfirmed(result)) {
      throw jsonError(
        "The integration could not complete that action. Reconnect it and try again.",
        502
      );
    }

    return { result };
  });
}
