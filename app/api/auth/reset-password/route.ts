import { handleApi, jsonError } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { getStore } from "@/lib/store";
import { getPrisma } from "@/lib/prisma";
import { consumeAccountAndIpLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Set / reset password via invite or forgot-password token.
 * Also serves as invite redeem: first-login password set for magic-link invites.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      password?: string;
    };
    const token = (body.token || "").trim();
    const password = body.password || "";

    if (!token) throw jsonError("Reset token is required", 400);
    if (!(await consumeAccountAndIpLimit({ scope: "reset-password", account: token, req, accountMax: 6, ipMax: 30, windowSeconds: 3600 }))) {
      throw jsonError("Too many reset attempts. Try again later.", 429);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw jsonError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const store = await getStore();
    const user = await store.getUserByInviteToken(token);
    if (!user?.inviteTokenExpiresAt || new Date(user.inviteTokenExpiresAt).getTime() <= Date.now()) {
      throw jsonError("Invalid or expired reset link", 400);
    }

    await store.upsertUser({
      ...user,
      password: null,
      passwordHash: hashPassword(password),
      inviteToken: null,
      inviteTokenExpiresAt: null,
      mustResetPassword: false,
    });
    await getPrisma().authSession.deleteMany({ where: { userId: user.uid } });

    return { ok: true, email: user.email };
  });
}
