import { internalErrorResponse, jsonOk } from "@/lib/api";
import { revokeDatabaseSession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
  const authHeader = req.headers.get("authorization");
  const cookieHeader = req.headers.get("cookie") || "";
  const cookieToken = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : cookieToken;
  await revokeDatabaseSession(token ? decodeURIComponent(token) : null);
  const response = jsonOk({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return response;
  } catch (error) {
    return internalErrorResponse(error);
  }
}
