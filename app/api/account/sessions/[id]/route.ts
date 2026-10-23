import { handleApi, jsonError, jsonOk } from "@/lib/api";
import { recordAccountAudit } from "@/lib/accounts";
import { requestSessionToken, requireSession, revokeDatabaseSessionByPublicId, sessionTokenHash } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/**
 * Revokes one of the signed-in person's sessions by its public id. The target
 * is always resolved among the caller's own sessions, so an id that belongs
 * to someone else is simply not found. Revoking the current session also
 * clears the cookie; the caller is then signed out.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    if (!/^(ses|legacy)_[0-9a-f]{32}$/.test(id)) throw jsonError("Session not found", 404);
    const token = requestSessionToken(req);
    if (!token) throw jsonError("Unauthorized", 401);
    const removed = await revokeDatabaseSessionByPublicId(session.uid, id);
    if (!removed) throw jsonError("Session not found", 404);
    const current = removed.tokenHash === sessionTokenHash(token);
    await recordAccountAudit({ action: current ? "session.revoked.current" : "session.revoked", actor: session, targetUserId: session.uid, metadata: { sessionId: id } }).catch(() => undefined);
    const response = jsonOk({ ok: true, signedOut: current }, NO_STORE);
    if (current) {
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 0 });
    }
    return response;
  });
}
