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

    let driveConnected = false;
    if (composioConfigured) {
      const connections = await listBoatshipConnections(session.uid);
      driveConnected = Boolean(connections.find((c) => c.slug === "googledrive" && c.connected));
    }

    return {
      composioConfigured,
      llmConfigured,
      driveConnected,
      ready: composioConfigured && llmConfigured,
      userId: session.uid,
      message: !composioConfigured
        ? "Set COMPOSIO_API_KEY to enable the Drive agent."
        : !llmConfigured
          ? "Set OPENAI_API_KEY (or AI_GATEWAY_API_KEY) so the agent can reason."
          : !driveConnected
            ? "Connect Google Drive under Integrations (your account only), then chat here."
            : null,
    };
  });
}
