import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  isComposioConfiguredForUser,
  listBoatshipConnections,
  startToolkitConnect,
  BOATSHIP_TOOLKITS,
  ONBOARDING_INTEGRATION_WORKFLOWS,
} from "@/lib/composio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);

    if (!(await isComposioConfiguredForUser(session.uid))) {
      return {
        configured: false,
        toolkits: BOATSHIP_TOOLKITS.map((tk) => ({
          slug: tk.slug,
          name: tk.name,
          description: tk.description,
          connected: false,
          connectedAccountId: null,
          status: null,
          testTool: tk.testTool,
        })),
        message:
          "Add a Composio credential in the secure credentials panel above to enable integrations.",
        workflows: ONBOARDING_INTEGRATION_WORKFLOWS,
      };
    }

    const toolkits = await listBoatshipConnections(session.uid);
    return {
      configured: true,
      toolkits,
      slackChannel: process.env.COMPOSIO_SLACK_CHANNEL || null,
      workflows: ONBOARDING_INTEGRATION_WORKFLOWS,
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!(await isComposioConfiguredForUser(session.uid))) {
      throw jsonError("Composio is not configured for this user or the server", 503);
    }

    const body = (await req.json().catch(() => ({}))) as { toolkit?: string };
    const toolkit = body.toolkit?.trim().toLowerCase();
    if (!toolkit) throw jsonError("toolkit is required", 400);

    const allowed = BOATSHIP_TOOLKITS.some((t) => t.slug === toolkit);
    if (!allowed) {
      throw jsonError(
        `Unknown toolkit. Allowed: ${BOATSHIP_TOOLKITS.map((t) => t.slug).join(", ")}`,
        400
      );
    }

    const result = await startToolkitConnect(session.uid, toolkit, req);
    if (!result.redirectUrl) {
      throw jsonError("Composio did not return a connect URL", 502);
    }
    return result;
  });
}
