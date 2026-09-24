import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import type { AppUser } from "@/types";

export const runtime = "nodejs";

function publicAccount(user: AppUser) {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    createdAt: user.createdAt,
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
  });
}

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

    let name: string | undefined;
    if ("name" in fields) {
      if (typeof fields.name !== "string") throw jsonError("Name must be text", 400);
      name = fields.name.trim();
      if (name.length < 2 || name.length > 100) {
        throw jsonError("Name must be between 2 and 100 characters", 400);
      }
    }
    if ("digestEnabled" in fields && typeof fields.digestEnabled !== "boolean") {
      throw jsonError("Digest preference must be true or false", 400);
    }

    const store = await getStore();
    const user = await store.getUser(session.uid);
    if (!user) throw jsonError("User not found", 404);
    const updated = await store.upsertUser({
      ...user,
      ...(name !== undefined ? { name } : {}),
      ...(typeof fields.digestEnabled === "boolean"
        ? { digestEnabled: fields.digestEnabled }
        : {}),
    });
    return { user: publicAccount(updated) };
  });
}
