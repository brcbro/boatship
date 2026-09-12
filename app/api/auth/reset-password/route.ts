import { handleApi, jsonError } from "@/lib/api";
import { hashPassword } from "@/lib/password";
import { getStore } from "@/lib/store";

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
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw jsonError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const store = await getStore();
    const user = await store.getUserByInviteToken(token);
    if (!user) throw jsonError("Invalid or expired reset link", 400);

    await store.upsertUser({
      ...user,
      password: null,
      passwordHash: hashPassword(password),
      inviteToken: null,
      inviteTokenExpiresAt: null,
      mustResetPassword: false,
    });

    return { ok: true, email: user.email };
  });
}
