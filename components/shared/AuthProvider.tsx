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
import { safeNextPath } from "@/lib/utils";

type AuthContextValue = {
  session: AuthSession | null;
  token: string | null;
  loading: boolean;
  /**
   * Set when the first session check failed with a network or server error,
   * so the session is unknown rather than absent. Shells show a retry state.
   */
  sessionError: string | null;
  login: (email: string, password: string, next?: string | null) => Promise<AuthSession>;
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
  const [sessionError, setSessionError] = useState<string | null>(null);
  const hasValidatedSession = useRef(false);
  // One request at a time: a pathname change (or StrictMode's second effect
  // run) while the first check is in flight reuses it instead of fetching again.
  const inFlight = useRef<Promise<void> | null>(null);
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const clearLocalSession = useCallback(() => {
    setStoredSession(null);
    setStoredToken(null);
    setToken(null);
    setSession(null);
  }, []);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const data = await apiFetch<{ session: AuthSession | null }>("/api/auth/session");
        hasValidatedSession.current = true;
        setSessionError(null);
        if (!data.session) {
          clearLocalSession();
          const current = pathnameRef.current;
          if (current !== "/login") {
            router.replace(`/login?next=${encodeURIComponent(current)}`);
          }
          return;
        }
        setSession(data.session);
        setStoredSession(data.session);
        setToken(getStoredToken());
      } catch (error) {
        // A temporary database/network failure is not proof that the session is
        // invalid, so keep any verified state. Before the first successful check
        // there is no verified state: report it so the shell offers a retry
        // instead of rendering pages with no session.
        if (!hasValidatedSession.current) {
          setSessionError(error instanceof Error ? error.message : "Unable to reach Boatship");
        }
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [clearLocalSession, router]);

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
    async (email: string, password: string, next?: string | null) => {
      const data = await apiFetch<{ token: string; session: AuthSession }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(data.token);
      setStoredSession(data.session);
      setToken(data.token);
      setSession(data.session);
      setSessionError(null);
      hasValidatedSession.current = true;
      router.push(safeNextPath(next, data.session.role) ?? homePathForRole(data.session.role));
      return data.session;
    },
    [router]
  );

  const logout = useCallback(async () => {
    let confirmed = false;
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      confirmed = true;
    } finally {
      // Sign out locally even when the server call fails, so a shared device is
      // never left signed in. The caller still sees the error, and the login
      // page says the server did not confirm.
      clearLocalSession();
      hasValidatedSession.current = false;
      router.push(confirmed ? "/login" : "/login?signout=unconfirmed");
    }
  }, [clearLocalSession, router]);

  const value = useMemo(
    () => ({ session, token, loading: pathname === "/" ? false : loading, sessionError, login, logout, refresh }),
    [session, token, loading, sessionError, pathname, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
