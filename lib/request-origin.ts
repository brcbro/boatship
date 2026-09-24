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
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}
