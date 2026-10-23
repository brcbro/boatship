import { handleApi, jsonError } from "@/lib/api";
import { accountStatus } from "@/lib/account-status";
import { requireSession } from "@/lib/auth";
import { getStore, type UserFieldPatch } from "@/lib/store";
import type { AppUser } from "@/types";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/** The person's own account; never includes credentials, tokens or hashes. */
function publicAccount(user: AppUser) {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    createdAt: user.createdAt,
    status: accountStatus(user),
    digestEnabled: user.digestEnabled ?? false,
    hasPassword: Boolean(user.passwordHash || user.password),
  };
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const user = await (await getStore()).getUser(session.uid);
    if (!user) throw jsonError("User not found", 404);
    return { user: publicAccount(user) };
  }, NO_STORE);
}

/**
 * Self-service profile update. Only the allowlisted fields can be submitted;
 * `uid` comes from the session, and the write replaces just the submitted
 * fields so a concurrent password, status or permission change is kept.
 */
export async function PATCH(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw jsonError("Invalid account update", 400);
    }

    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some((field) => field !== "name" && field !== "digestEnabled")) {
      throw jsonError("Unsupported account field", 400);
    }
    if (!("name" in fields) && !("digestEnabled" in fields)) {
      throw jsonError("No account changes provided", 400);
    }

    const patch: UserFieldPatch = {};
    if ("name" in fields) {
      if (typeof fields.name !== "string") throw jsonError("Name must be text", 400);
      const name = fields.name.trim();
      if (name.length < 2 || name.length > 100) {
        throw jsonError("Name must be between 2 and 100 characters", 400);
      }
      patch.name = name;
    }
    if ("digestEnabled" in fields) {
      if (typeof fields.digestEnabled !== "boolean") throw jsonError("Digest preference must be true or false", 400);
      patch.digestEnabled = fields.digestEnabled;
    }

    const store = await getStore();
    if (!(await store.getUser(session.uid))) throw jsonError("User not found", 404);
    const updated = await store.updateUserFields(session.uid, patch);
    return { user: publicAccount(updated) };
  }, NO_STORE);
}
