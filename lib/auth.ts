import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { AuthSession, UserRole } from "@/types";
import { getStore } from "@/lib/store";
import { getPrisma } from "@/lib/prisma";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import {
  SESSION_COOKIE,
  encodeLocalSession,
} from "@/lib/session";

export { SESSION_COOKIE, encodeLocalSession };

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDatabaseSession(session: AuthSession) {
  const token = `${encodeLocalSession(session)}.${randomBytes(32).toString("base64url")}`;
  await getPrisma().authSession.create({
    data: {
      tokenHash: tokenHash(token),
      userId: session.uid,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function revokeDatabaseSession(token: string | null | undefined) {
  if (!token) return;
  await getPrisma().$executeRaw`DELETE FROM "AuthSession" WHERE "tokenHash" = ${tokenHash(token)}`;
}

async function getDatabaseSession(token: string): Promise<AuthSession | null> {
  const record = await getPrisma().authSession.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!record) return null;
  if (record.expiresAt.getTime() <= Date.now()) {
    await revokeDatabaseSession(token);
    return null;
  }

  const user = await (await getStore()).getUser(record.userId);
  if (!user || user.mustResetPassword || isUnsafeDemoUser(user)) return null;
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    permissions: user.permissions,
  };
}

export async function verifyIdToken(idToken: string): Promise<AuthSession | null> {
  const database = await getDatabaseSession(idToken);
  if (database) return database;

  return null;
}

export async function getSessionFromRequest(req: Request): Promise<AuthSession | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match?.[1]) {
    // Browser requests may also carry an old local-storage bearer token. The
    // HTTP-only cookie is the authoritative browser session; prioritising it
    // prevents an expired header from logging a valid dashboard session out
    // during a page refresh.
    return verifyIdToken(decodeURIComponent(match[1]));
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyIdToken(authHeader.slice(7));
  }

  return null;
}

export async function getServerSession(): Promise<AuthSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyIdToken(token);
}

export async function requireSession(req: Request) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export async function requireRoles(req: Request, roles: UserRole[]) {
  const session = await requireSession(req);
  if (!roles.includes(session.role)) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export async function ensureUserProfile(session: AuthSession) {
  const store = await getStore();
  const existing = await store.getUser(session.uid);
  if (existing) return existing;
  return store.upsertUser({
    uid: session.uid,
    email: session.email,
    name: session.name,
    role: session.role,
    clientId: session.clientId,
    createdAt: new Date().toISOString(),
  });
}
