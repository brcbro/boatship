import { handleApi, jsonError } from "@/lib/api";
import { requireSession, SESSION_COOKIE } from "@/lib/auth";
import { sha256Hex } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";

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
    const records = await getPrisma().authSession.findMany({
      where: { userId: session.uid, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return {
      sessions: records.map((record) => ({
        id: record.tokenHash,
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
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
    const revoked = await getPrisma().$executeRaw`DELETE FROM "AuthSession" WHERE "userId" = ${session.uid} AND "tokenHash" <> ${sha256Hex(token)}`;
    return { ok: true, revoked };
  });
}
