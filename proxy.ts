import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decodeLocalSession } from "@/lib/session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

const ADMIN_PATHS = [
  "/dashboard", "/clients", "/team", "/workload", "/projects",
  "/products", "/workspace", "/calendar", "/messages", "/templates",
  "/forms", "/analytics", "/accounting", "/integrations", "/webhooks",
  "/mcp", "/compliance", "/hodi", "/automations", "/agent",
  "/tasks", "/reminders",
];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isAdminArea = ADMIN_PATHS.some((route) => matchesRoute(pathname, route));
  const isClientArea = matchesRoute(pathname, "/portal");
  const isProtected = isAdminArea || isClientArea;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? decodeLocalSession(token) : null;

  // The public marketing homepage is intentionally available to both signed-in
  // and prospective users. Product-area routing remains role-aware below.
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (!session && isProtected && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Do not redirect `/login` based only on the unsigned token payload here.
  // The API verifies the database-backed session. Redirecting before that
  // verification causes expired cookies to loop between dashboard and login.

  if (session) {
    if (session.role === "client" && isAdminArea) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal";
      return NextResponse.redirect(url);
    }
    if ((session.role === "admin" || session.role === "team") && isClientArea) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Keep the public landing page and static assets on Cloudflare's asset/CDN
  // path. Protected application routes still pass through this proxy.
  matcher: ["/((?!$|_next/static|_next/image|favicon.ico).*)"],
};
