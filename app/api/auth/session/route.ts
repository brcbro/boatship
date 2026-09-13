import { handleApi } from "@/lib/api";
import { getSessionFromRequest, SESSION_COOKIE } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  let session: Awaited<ReturnType<typeof getSessionFromRequest>> = null;
  const response = (await handleApi(async () => {
    session = await getSessionFromRequest(req);
    return { session };
  })) as NextResponse;

  // Remove an expired database session cookie so the middleware cannot keep
  // treating the browser as logged in while API requests correctly return 401.
  if (!session && !req.headers.get("authorization")) {
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }

  return response;
}
