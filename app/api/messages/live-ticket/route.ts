import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { issueMessageRealtimeTicket } from "@/lib/realtime/message-ticket";
import { canAccessClient } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const runtime = "nodejs";

function realtimeSecret() {
  // Keep the signing key independent from the browser session. The custom
  // Worker verifies tickets without querying the database on every socket.
  try {
    const value = (getCloudflareContext().env as CloudflareEnv & { MESSAGE_REALTIME_SECRET?: string })
      .MESSAGE_REALTIME_SECRET?.trim();
    if (value) return value;
  } catch {
    // Local Next development does not have an OpenNext request context.
  }
  return process.env.MESSAGE_REALTIME_SECRET?.trim();
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) throw jsonError("clientId is required", 400);
    if (!canAccessClient(session, clientId)) throw jsonError("Forbidden", 403);
    if (!(await (await getStore()).getClient(clientId))) throw jsonError("Client not found", 404);

    const secret = realtimeSecret();
    if (!secret) throw jsonError("Live messages are not configured", 503);

    return {
      ticket: await issueMessageRealtimeTicket(
        { clientId, uid: session.uid, role: session.role },
        secret
      ),
      expiresIn: 60,
    };
  });
}
