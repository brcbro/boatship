import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  listUserSecretMetadata,
  upsertUserSecret,
  USER_SECRET_PROVIDERS,
  WORKSPACE_SECRET_USER_ID,
} from "@/lib/user-secrets";

export const runtime = "nodejs";

function targetUserId(session: { uid: string; role: string }, requested?: string) {
  // Credentials are entered once for the workspace and are intentionally
  // independent of the current login session.
  const target = requested?.trim() || WORKSPACE_SECRET_USER_ID;
  if (target !== session.uid && session.role !== "admin") throw jsonError("Forbidden", 403);
  return target;
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const userId = targetUserId(session, new URL(req.url).searchParams.get("userId") || undefined);
    return { secrets: await listUserSecretMetadata(userId) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      provider?: string;
      value?: string;
    };
    const userId = targetUserId(session, body.userId);
    if (!body.provider || !USER_SECRET_PROVIDERS.includes(body.provider as (typeof USER_SECRET_PROVIDERS)[number])) {
      throw jsonError("provider must be composio or openrouter", 400);
    }
    if (!body.value?.trim()) throw jsonError("value is required", 400);
    try {
      return { secret: await upsertUserSecret(userId, body.provider, body.value) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Secret could not be stored";
      if (message.includes("BOATSHIP_SECRETS_MASTER_KEY")) {
        throw jsonError("Secure secret storage is not configured on the server", 503);
      }
      throw error;
    }
  });
}
