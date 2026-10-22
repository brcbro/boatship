import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { AuthSession, UserRole } from "@/types";
import { getStore } from "@/lib/store";
import { Collection, nowIso } from "@/lib/firestore";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { requireStaffRequestPermissions } from "@/lib/rbac";
import {
  SESSION_COOKIE,
  encodeLocalSession,
} from "@/lib/session";

export { SESSION_COOKIE, encodeLocalSession };

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/** Keyed by the SHA-256 of the bearer token; never stores the token itself. */
export type AuthSessionDoc = { tokenHash: string; userId: string; expiresAt: string; createdAt: string };
export const AUTH_SESSIONS = new Collection<AuthSessionDoc>("AuthSession");

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDatabaseSession(session: AuthSession) {
  const token = `${encodeLocalSession(session)}.${randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(token);
  await AUTH_SESSIONS.create(hash, { tokenHash: hash, userId: session.uid, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(), createdAt: nowIso() });
  return token;
}

export async function revokeDatabaseSession(token: string | null | undefined) {
  if (!token) return;
  await AUTH_SESSIONS.delete(tokenHash(token));
}

/** Active sessions for a user, newest first. */
export async function listDatabaseSessions(userId: string) {
  const records = await AUTH_SESSIONS.find([{ field: "userId", op: "==", value: userId }, { field: "expiresAt", op: ">", value: nowIso() }]);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Revokes every session of a user except the one whose token hash is given; returns the count. */
export async function revokeOtherDatabaseSessions(userId: string, keepTokenHash?: string | null) {
  const records = await AUTH_SESSIONS.find([{ field: "userId", op: "==", value: userId }]);
  const targets = records.filter((record) => record.tokenHash !== keepTokenHash);
  for (const record of targets) await AUTH_SESSIONS.delete(record.tokenHash);
  return targets.length;
}

async function getDatabaseSession(token: string): Promise<AuthSession | null> {
  const record = await AUTH_SESSIONS.get(tokenHash(token));
  if (!record) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
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
    const session = await verifyIdToken(decodeURIComponent(match[1]));
    if (session) requireStaffRequestPermissions(session, req);
    return session;
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const session = await verifyIdToken(authHeader.slice(7));
    if (session) requireStaffRequestPermissions(session, req);
    return session;
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
