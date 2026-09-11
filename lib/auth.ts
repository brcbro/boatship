import { cookies } from "next/headers";
import type { AuthSession, UserRole } from "@/types";
import { getAdminAuth, isFirebaseAdminConfigured } from "@/lib/firebase-admin";
import { getStore } from "@/lib/store";
import {
  SESSION_COOKIE,
  decodeLocalSession,
  encodeLocalSession,
} from "@/lib/session";

export { SESSION_COOKIE, encodeLocalSession };

export async function verifyIdToken(idToken: string): Promise<AuthSession | null> {
  const local = decodeLocalSession(idToken);
  if (local) return local;

  if (isFirebaseAdminConfigured()) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      const role = (decoded.role as UserRole) || "client";
      return {
        uid: decoded.uid,
        email: decoded.email || "",
        name: (decoded.name as string) || decoded.email || "User",
        role,
        clientId: (decoded.clientId as string) || null,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function getSessionFromRequest(req: Request): Promise<AuthSession | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyIdToken(authHeader.slice(7));
  }
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (match?.[1]) {
    return verifyIdToken(decodeURIComponent(match[1]));
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
