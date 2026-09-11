import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  isComposioConfigured,
  listBoatshipConnections,
  startToolkitConnect,
  BOATSHIP_TOOLKITS,
} from "@/lib/composio";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);

    if (!isComposioConfigured()) {
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
          "Set COMPOSIO_API_KEY to enable integrations. Get a key at https://app.composio.dev",
      };
    }

    const toolkits = await listBoatshipConnections(session.uid);
    return {
      configured: true,
      toolkits,
      slackChannel: process.env.COMPOSIO_SLACK_CHANNEL || null,
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!isComposioConfigured()) {
      throw jsonError("COMPOSIO_API_KEY is not set", 503);
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
