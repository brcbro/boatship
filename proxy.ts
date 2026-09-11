import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decodeLocalSession } from "@/lib/session";
import { homePathForRole } from "@/lib/rbac";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

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
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? decodeLocalSession(token) : null;

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = session ? homePathForRole(session.role) : "/login";
    return NextResponse.redirect(url);
  }

  if (!session && !isPublic && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = homePathForRole(session.role);
    return NextResponse.redirect(url);
  }

  if (session) {
    const isAdminArea =
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/clients") ||
      pathname.startsWith("/team") ||
      pathname.startsWith("/workload") ||
      pathname.startsWith("/calendar") ||
      pathname.startsWith("/templates") ||
      pathname.startsWith("/forms") ||
      pathname.startsWith("/analytics") ||
      pathname.startsWith("/integrations") ||
      pathname.startsWith("/webhooks") ||
      pathname.startsWith("/compliance") ||
      pathname.startsWith("/agent") ||
      pathname.startsWith("/messages");
    const isClientArea = pathname.startsWith("/portal");

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
