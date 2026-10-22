import { handleApi, jsonError } from "@/lib/api";
import { listDatabaseSessions, requireSession, revokeOtherDatabaseSessions, SESSION_COOKIE } from "@/lib/auth";
import { sha256Hex } from "@/lib/password";

export const runtime = "nodejs";

function currentToken(req: Request) {
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (cookie) return decodeURIComponent(cookie);
  const authorization = req.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const token = currentToken(req);
    if (!token) throw jsonError("Unauthorized", 401);
    const currentHash = sha256Hex(token);
    const records = await listDatabaseSessions(session.uid);
    return {
      sessions: records.map((record) => ({
        id: record.tokenHash,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        current: record.tokenHash === currentHash,
      })),
    };
  });
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const token = currentToken(req);
    if (!token) throw jsonError("Unauthorized", 401);
    const revoked = await revokeOtherDatabaseSessions(session.uid, sha256Hex(token));
    return { ok: true, revoked };
  });
}
