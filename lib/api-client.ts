"use client";

import type { AuthSession } from "@/types";

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(path, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("boatship_token");
}

export function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("boatship_token", token);
  else localStorage.removeItem("boatship_token");
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("boatship_session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setStoredSession(session: AuthSession | null) {
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem("boatship_session", JSON.stringify(session));
  else localStorage.removeItem("boatship_session");
}
