"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthSession } from "@/types";
import {
  apiFetch,
  getStoredSession,
  getStoredToken,
  setStoredSession,
  setStoredToken,
} from "@/lib/api-client";
import { homePathForRole } from "@/lib/rbac";

type AuthContextValue = {
  session: AuthSession | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ session: AuthSession | null }>("/api/auth/session");
      if (!data.session) {
        setSession(null);
        setStoredSession(null);
        setStoredToken(null);
        setToken(null);
        if (pathname !== "/login") router.replace("/login");
        return;
      }
      setSession(data.session);
      setStoredSession(data.session);
      const t = getStoredToken();
      setToken(t);
    } catch {
      setSession(null);
      setStoredSession(null);
      setToken(null);
      if (pathname !== "/login") router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    setSession(getStoredSession());
    setToken(getStoredToken());
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiFetch<{ token: string; session: AuthSession }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(data.token);
      setStoredSession(data.session);
      setToken(data.token);
      setSession(data.session);
      router.push(homePathForRole(data.session.role));
      router.refresh();
      return data.session;
    },
    [router]
  );

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setStoredToken(null);
    setStoredSession(null);
    setToken(null);
    setSession(null);
    router.push("/login");
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ session, token, loading, login, logout, refresh }),
    [session, token, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
