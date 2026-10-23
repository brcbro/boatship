import { handleApi, jsonError, jsonOk } from "@/lib/api";
import { AccountError, applyAccountChange, passwordPolicyError } from "@/lib/accounts";
import { currentAuthzVersion } from "@/lib/account-status";
import { requestSessionToken, requireSession, rotateDatabaseSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { consumeRateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { AuthSession } from "@/types";

export const runtime = "nodejs";

/**
 * Change the signed-in person's password. The credential is written as a
 * field-level, versioned change (never a whole-user upsert), the user's authz
 * version is bumped so every existing session stops verifying on every
 * runtime, and the caller receives a freshly issued session in its place.
 */
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
    const policy = passwordPolicyError(newPassword);
    if (policy) throw jsonError(`New password: ${policy.charAt(0).toLowerCase()}${policy.slice(1)}`, 400);
    if (newPassword === currentPassword) {
      throw jsonError("Choose a different new password", 400);
    }
    if (!(await consumeRateLimit({ scope: "account-password", identity: session.uid, max: 10, windowSeconds: 3600 }))) {
      throw jsonError("Too many password changes. Try again later.", 429);
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

    let updated;
    try {
      updated = await applyAccountChange({
        uid: user.uid,
        bumpAuthz: true,
        patch: () => ({ password: null, passwordHash: hashPassword(newPassword), mustResetPassword: false }),
        audit: { action: "credential.password.changed", actor: session },
      });
    } catch (error) {
      if (error instanceof AccountError) throw jsonError(error.message, error.status);
      throw error;
    }

    const next: AuthSession = { uid: updated.uid, email: updated.email, name: updated.name, role: updated.role, clientId: updated.clientId, permissions: updated.permissions };
    const rotated = await rotateDatabaseSession(requestSessionToken(req), next, { authzVersion: currentAuthzVersion(updated) });
    const response = jsonOk({ ok: true, token: rotated.token, signedOut: rotated.revoked }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.set(SESSION_COOKIE, rotated.token, sessionCookieOptions());
    return response;
  });
}
