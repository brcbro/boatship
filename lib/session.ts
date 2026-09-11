import type { AuthSession, UserRole } from "@/types";

export const SESSION_COOKIE = "boatship_session";

function base64UrlToString(token: string) {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.from(atob(base64), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

function stringToBase64Url(value: string) {
  if (typeof btoa === "function") {
    const base64 = btoa(unescape(encodeURIComponent(value)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  return Buffer.from(value, "utf8").toString("base64url");
}

export function encodeLocalSession(session: AuthSession) {
  return stringToBase64Url(JSON.stringify(session));
}

/** Edge-safe session decode for local/demo tokens (and opaque passthrough shape checks). */
export function decodeLocalSession(token: string): AuthSession | null {
  try {
    const parsed = JSON.parse(base64UrlToString(token)) as AuthSession;
    if (!parsed?.uid || !parsed?.role) return null;
    const role = parsed.role as UserRole;
    if (!["admin", "team", "client"].includes(role)) return null;
    return {
      uid: parsed.uid,
      email: parsed.email || "",
      name: parsed.name || parsed.email || "User",
      role,
      clientId: parsed.clientId ?? null,
    };
  } catch {
    return null;
  }
}
