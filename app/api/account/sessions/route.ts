import { handleApi, jsonError } from "@/lib/api";
import { listDatabaseSessions, requestSessionToken, requireSession, revokeOtherDatabaseSessions, sessionPublicId, sessionTokenHash } from "@/lib/auth";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/** The person's own sessions, named by opaque public ids; token hashes never leave the server. */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const token = requestSessionToken(req);
    if (!token) throw jsonError("Unauthorized", 401);
    const currentHash = sessionTokenHash(token);
    const records = await listDatabaseSessions(session.uid);
    return {
      sessions: records.map((record) => ({
        id: sessionPublicId(record),
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        current: record.tokenHash === currentHash,
      })),
    };
  }, NO_STORE);
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const token = requestSessionToken(req);
    if (!token) throw jsonError("Unauthorized", 401);
    const revoked = await revokeOtherDatabaseSessions(session.uid, sessionTokenHash(token));
    return { ok: true, revoked };
  }, NO_STORE);
}
