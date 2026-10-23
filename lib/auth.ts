import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import type { AuthSession, UserRole } from "@/types";
import { getStore } from "@/lib/store";
import { Collection, nowIso } from "@/lib/firestore";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { accountCanAuthenticate, currentAuthzVersion } from "@/lib/account-status";
import { requireStaffRequestPermissions } from "@/lib/rbac";
import {
  SESSION_COOKIE,
  encodeLocalSession,
} from "@/lib/session";
import { cacheSession, forgetSession, forgetUserSessions, getCachedSession } from "@/lib/session-cache";

export { SESSION_COOKIE, encodeLocalSession };

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * Keyed by the SHA-256 of the bearer token; never stores the token itself.
 * `publicId` is what account UIs and APIs name a session by; it is unrelated
 * to the hash. `authzVersion` is the user's version when the session was
 * issued; a later status, role, permission or password change bumps the
 * user's version and every earlier session stops verifying on every runtime
 * instance, whether or not its record was deleted. Records written before
 * 2026-10-23 lack both fields.
 */
export type AuthSessionDoc = { tokenHash: string; userId: string; expiresAt: string; createdAt: string; publicId?: string; authzVersion?: number };
export const AUTH_SESSIONS = new Collection<AuthSessionDoc>("AuthSession");

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque session id for responses. Legacy records derive one that cannot be turned back into the hash. */
export function sessionPublicId(record: Pick<AuthSessionDoc, "tokenHash" | "publicId">) {
  return record.publicId ?? `legacy_${createHash("sha256").update(`session-public:${record.tokenHash}`).digest("hex").slice(0, 32)}`;
}

export async function createDatabaseSession(session: AuthSession, options: { authzVersion?: number } = {}) {
  const token = `${encodeLocalSession(session)}.${randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(token);
  const authzVersion = options.authzVersion ?? currentAuthzVersion((await (await getStore()).getUser(session.uid)) ?? {});
  await AUTH_SESSIONS.create(hash, {
    tokenHash: hash,
    userId: session.uid,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: nowIso(),
    publicId: `ses_${randomBytes(16).toString("hex")}`,
    authzVersion,
  });
  return token;
}

/** The bearer token of the request: the HTTP-only cookie first, then the Authorization header. */
export function requestSessionToken(req: Pick<Request, "headers">) {
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (cookie) return decodeURIComponent(cookie);
  const authorization = req.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export function sessionTokenHash(token: string) {
  return tokenHash(token);
}

/**
 * Replaces the caller's session after a credential change: every session of
 * the user, the current one included, is revoked and a fresh token is issued
 * under the user's current authz version. Returns how many other sessions
 * were signed out.
 */
export async function rotateDatabaseSession(currentToken: string | null, session: AuthSession, options: { authzVersion?: number } = {}) {
  const revoked = await revokeOtherDatabaseSessions(session.uid, null);
  if (currentToken) forgetSession(tokenHash(currentToken));
  const token = await createDatabaseSession(session, options);
  return { token, revoked: Math.max(0, revoked - (currentToken ? 1 : 0)) };
}

export async function revokeDatabaseSession(token: string | null | undefined) {
  if (!token) return;
  const hash = tokenHash(token);
  forgetSession(hash);
  await AUTH_SESSIONS.delete(hash);
}

/**
 * Revokes one of the user's own sessions by its public id. Legacy records have
 * a derived id, so the match compares derived ids across the user's sessions
 * rather than looking a hash up. Returns the record that was removed, or null
 * when no session of this user has that id (another user's id is never found).
 */
export async function revokeDatabaseSessionByPublicId(userId: string, publicId: string) {
  const records = await AUTH_SESSIONS.find([{ field: "userId", op: "==", value: userId }]);
  const target = records.find((record) => sessionPublicId(record) === publicId);
  if (!target) return null;
  forgetSession(target.tokenHash);
  await AUTH_SESSIONS.delete(target.tokenHash);
  return target;
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
  for (const record of targets) {
    forgetSession(record.tokenHash);
    await AUTH_SESSIONS.delete(record.tokenHash);
  }
  return targets.length;
}

export type VerifyOptions = {
  /**
   * Skip the per-runtime memo and verify against the database. Mutating
   * requests use this so a suspension, revocation or version bump committed
   * anywhere denies them at once; reads may be served from the memo for up to
   * SESSION_CACHE_TTL_MS after a change made on another runtime instance.
   */
  authoritative?: boolean;
};

async function getDatabaseSession(token: string, options: VerifyOptions = {}): Promise<AuthSession | null> {
  const hash = tokenHash(token);
  const cached = options.authoritative ? null : getCachedSession(hash);
  if (cached) return cached;

  const record = await AUTH_SESSIONS.get(hash);
  if (!record) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    await revokeDatabaseSession(token);
    return null;
  }

  const user = await (await getStore()).getUser(record.userId);
  const stale = record.authzVersion !== undefined && user !== null && record.authzVersion !== currentAuthzVersion(user);
  if (!user || !accountCanAuthenticate(user) || isUnsafeDemoUser(user) || stale) {
    // The account is gone, cannot sign in, or the session was issued before a
    // change that invalidates sessions (password, status, role, permissions).
    // The record is removed so the session list stays truthful.
    await revokeDatabaseSession(token);
    return null;
  }
  const session: AuthSession = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    permissions: user.permissions,
  };
  cacheSession(hash, session);
  return session;
}

/** Call after a user's role, permissions, password or existence changed. */
export function invalidateUserSessions(userId: string) {
  forgetUserSessions(userId);
}

export async function verifyIdToken(idToken: string, options: VerifyOptions = {}): Promise<AuthSession | null> {
  const database = await getDatabaseSession(idToken, options);
  if (database) return database;

  return null;
}

function isReadRequest(req: Pick<Request, "method">) {
  const method = req.method.toUpperCase();
  return method === "GET" || method === "HEAD";
}

export async function getSessionFromRequest(req: Request, options: VerifyOptions = {}): Promise<AuthSession | null> {
  // Browser requests may also carry an old local-storage bearer token. The
  // HTTP-only cookie is the authoritative browser session; prioritising it
  // prevents an expired header from logging a valid dashboard session out
  // during a page refresh.
  const token = requestSessionToken(req);
  if (!token) return null;
  const session = await verifyIdToken(token, { authoritative: options.authoritative ?? !isReadRequest(req) });
  if (session) requireStaffRequestPermissions(session, req);
  return session;
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
