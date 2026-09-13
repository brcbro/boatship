import { handleApi } from "@/lib/api";
import { isLlmConfiguredForUser } from "@/lib/agent";
import { requireRoles } from "@/lib/auth";
import { isComposioConfiguredForUser, listBoatshipConnections } from "@/lib/composio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const composioConfigured = await isComposioConfiguredForUser(session.uid);
    const llmConfigured = await isLlmConfiguredForUser(session.uid);

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
          ? "Add an OpenRouter credential in Integrations, or configure a server AI key, so the agent can reason."
          : !composioConfigured
            ? "Boatship knowledge is ready. Add a Composio credential in Integrations to use connected apps."
            : null,
    };
  });
}
