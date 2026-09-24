"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthSession } from "@/types";
import {
  apiFetch,
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
  const hasValidatedSession = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ session: AuthSession | null }>("/api/auth/session");
      if (!data.session) {
        hasValidatedSession.current = true;
        setSession(null);
        setStoredSession(null);
        setStoredToken(null);
        setToken(null);
        if (pathname !== "/login") {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
        return;
      }
      hasValidatedSession.current = true;
      setSession(data.session);
      setStoredSession(data.session);
      const t = getStoredToken();
      setToken(t);
    } catch {
      // A temporary database/network failure is not proof that the session is
      // invalid. Keep the current verified state instead of ejecting the user
      // from whichever workspace section they are using.
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    // The marketing home page is public. Avoid a Worker invocation plus the
    // session/database lookup for every anonymous landing-page visit.
    if (pathname === "/") {
      return;
    }

    // The session is shared by every workspace route. Revalidating it on each
    // pathname change causes unnecessary database work and can redirect users
    // during navigation when a single lookup is slow or temporarily fails.
    if (hasValidatedSession.current) return;

    // Do not expose a cached browser session before the server has validated
    // its database-backed token. Otherwise protected pages can issue API
    // requests with an expired token and briefly render an "Unauthorized"
    // error before this provider redirects to login.
    void refresh();
  }, [pathname, refresh]);

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
      hasValidatedSession.current = true;
      router.push(homePathForRole(data.session.role));
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
    hasValidatedSession.current = false;
    router.push("/login");
  }, [router]);

  const value = useMemo(
    () => ({ session, token, loading: pathname === "/" ? false : loading, login, logout, refresh }),
    [session, token, loading, pathname, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
