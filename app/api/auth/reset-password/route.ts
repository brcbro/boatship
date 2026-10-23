import { handleApi, jsonError } from "@/lib/api";
import { AccountError, passwordPolicyError, redeemCredentialAction } from "@/lib/accounts";
import { accountStatus } from "@/lib/account-status";
import { revokeOtherDatabaseSessions } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { getStore } from "@/lib/store";
import { consumeAccountAndIpLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Set / reset password via an invitation or recovery link. The token is a
 * purpose-bound credential action: validation, consumption and the password
 * update commit together, so a link works exactly once. Every session of the
 * account is revoked afterwards; the person signs in again.
 *
 * Links issued before 2026-10-23 stored the token on the user record. They are
 * still accepted until they expire (at most 14 days after issue) through the
 * legacy branch below, which is the bounded migration path for old emails.
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
    const policy = passwordPolicyError(password);
    if (policy) throw jsonError(policy, 400);

    const store = await getStore();
    const passwordHash = hashPassword(password);
    try {
      const { user } = await redeemCredentialAction({ token, purposes: ["invite", "password_reset"], passwordHash });
      await revokeOtherDatabaseSessions(user.uid, null);
      return { ok: true, email: user.email };
    } catch (error) {
      if (!(error instanceof AccountError) || error.code !== "credential_invalid") {
        if (error instanceof AccountError) throw jsonError(error.message, error.status);
        throw error;
      }
    }

    // Legacy link: token stored on the user record.
    const legacy = await store.getUserByInviteToken(token);
    if (!legacy?.inviteTokenExpiresAt || new Date(legacy.inviteTokenExpiresAt).getTime() <= Date.now()) {
      throw jsonError("Invalid or expired reset link", 400);
    }
    const status = accountStatus(legacy);
    if (status === "suspended" || status === "deactivated") {
      throw jsonError("This account cannot sign in. Contact an administrator.", 403);
    }
    const user = await store.updateUserFields(legacy.uid, {
      password: null,
      passwordHash,
      inviteToken: null,
      inviteTokenExpiresAt: null,
      mustResetPassword: false,
      status: "active",
      authzVersion: (legacy.authzVersion ?? 0) + 1,
    });
    await revokeOtherDatabaseSessions(user.uid, null);

    return { ok: true, email: user.email };
  }, { headers: { "Cache-Control": "private, no-store" } });
}
