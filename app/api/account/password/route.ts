import { handleApi, jsonError } from "@/lib/api";
import { requireSession, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword, sha256Hex, verifyPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

function currentToken(req: Request) {
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (cookie) return decodeURIComponent(cookie);
  const authorization = req.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw jsonError("Current and new passwords are required", 400);
    }
    const { currentPassword, newPassword } = body as Record<string, unknown>;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      throw jsonError("Current and new passwords are required", 400);
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      throw jsonError("New password must be between 8 and 128 characters", 400);
    }
    if (newPassword === currentPassword) {
      throw jsonError("Choose a different new password", 400);
    }

    const store = await getStore();
    const user = await store.getUser(session.uid);
    if (!user) throw jsonError("User not found", 404);
    const valid = user.passwordHash
      ? verifyPassword(currentPassword, user.passwordHash)
      : process.env.ALLOW_LOCAL_STORE === "1" && process.env.NODE_ENV !== "production"
        ? Boolean(user.password) && currentPassword === user.password
        : false;
    if (!valid) throw jsonError("Current password is incorrect", 400);

    await store.upsertUser({
      ...user,
      password: null,
      passwordHash: hashPassword(newPassword),
      mustResetPassword: false,
    });

    const token = currentToken(req);
    if (token) {
      await getPrisma().authSession.deleteMany({
        where: { userId: user.uid, tokenHash: { not: sha256Hex(token) } },
      });
    }
    return { ok: true };
  });
}
