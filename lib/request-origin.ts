const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Cookie-authenticated API mutations must originate from this exact origin. */
export function isCrossOriginCookieMutation(request: Request, sessionCookie: string) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return false;
  if (!new URL(request.url).pathname.startsWith("/api/")) return false;
  const cookie = request.headers.get("cookie") || "";
  if (!cookie.split(";").some((part) => part.trim().startsWith(`${sessionCookie}=`))) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const target = new URL(request.url);
    // Next dev canonicalizes proxy URLs to localhost even when the browser
    // requested another loopback host. Use only that actual loopback Host;
    // hosted requests retain exact URL-origin validation.
    if (process.env.NODE_ENV === "development" && target.hostname === "localhost") {
      const host = request.headers.get("host");
      if (host) {
        const local = new URL(`${target.protocol}//${host}`);
        if (!local.username && !local.password && local.pathname === "/" && !local.search && !local.hash && ["localhost", "127.0.0.1", "[::1]"].includes(local.hostname)) target.host = local.host;
      }
    }
    return new URL(origin).origin !== target.origin;
  } catch {
    return true;
  }
}
