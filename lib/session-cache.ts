import type { AuthSession } from "@/types";

/**
 * Short-lived, per-runtime-instance memo of verified sessions keyed by the
 * token hash. One page load verifies the same cookie from several server
 * components and API routes; without this each verification is two database
 * reads (the session record and the user profile). Entries expire after
 * SESSION_CACHE_TTL_MS, and every path that revokes a session or changes a
 * user clears the affected entries, so the window only covers changes made
 * from another runtime instance.
 */
export const SESSION_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;

type Entry = { session: AuthSession; expiresAt: number };
const entries = new Map<string, Entry>();

export function getCachedSession(tokenHash: string): AuthSession | null {
  const entry = entries.get(tokenHash);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(tokenHash);
    return null;
  }
  return entry.session;
}

export function cacheSession(tokenHash: string, session: AuthSession) {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(tokenHash, { session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
}

/** Drops one token's entry (logout, revoke). */
export function forgetSession(tokenHash: string) {
  entries.delete(tokenHash);
}

/** Drops every entry for a user (role, permission, password or deletion changes). */
export function forgetUserSessions(userId: string) {
  for (const [hash, entry] of entries) if (entry.session.uid === userId) entries.delete(hash);
}

/** Drops everything; tests call it between fixtures. */
export function clearSessionCache() {
  entries.clear();
}
