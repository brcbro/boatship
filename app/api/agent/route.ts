import { handleApi } from "@/lib/api";
import { isLlmConfigured } from "@/lib/agent";
import { requireRoles } from "@/lib/auth";
import { isComposioConfigured, listBoatshipConnections } from "@/lib/composio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const composioConfigured = isComposioConfigured();
    const llmConfigured = isLlmConfigured();

    let connectors: Awaited<ReturnType<typeof listBoatshipConnections>> = [];
    if (composioConfigured) {
      connectors = await listBoatshipConnections(session.uid);
    }

    return {
      composioConfigured,
      llmConfigured,
      driveConnected: Boolean(connectors.find((c) => c.slug === "googledrive" && c.connected)),
      connectors,
      ready: llmConfigured,
      userId: session.uid,
      message: !llmConfigured
          ? "Set OPENROUTER_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY so the agent can reason."
          : !composioConfigured
            ? "Boatship knowledge is ready. Add COMPOSIO_API_KEY to use connected apps."
            : null,
    };
  });
}
