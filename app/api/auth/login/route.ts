import { internalErrorResponse, jsonError, jsonOk } from "@/lib/api";
import { createDatabaseSession, SESSION_COOKIE } from "@/lib/auth";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { verifyPassword } from "@/lib/password";
import { consumeAccountAndIpLimit } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";
import type { AuthSession } from "@/types";

export const runtime = "nodejs";

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  };
}

function passwordsMatch(password: string, expected: string | null | undefined) {
  return Boolean(expected) && password === expected;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (!email || !password) {
      return jsonError("Email and password are required", 400);
    }

    if (!(await consumeAccountAndIpLimit({ scope: "login", account: email, req, accountMax: 20, ipMax: 80, windowSeconds: 900 }))) {
      return jsonError("Too many login attempts. Try again in 15 minutes.", 429);
    }

    const store = await getStore();
    const user = await store.getUserByEmail(email);
    if (!user || isUnsafeDemoUser(user)) {
      return jsonError("Invalid email or password", 401);
    }

    if (user.mustResetPassword) {
      return jsonError("Set your password using the link sent to your email before signing in", 403);
    }

    let ok = false;
    if (user.passwordHash) {
      ok = verifyPassword(password, user.passwordHash);
    } else {
      const expected =
        process.env.ALLOW_LOCAL_STORE === "1" && process.env.NODE_ENV !== "production"
          ? user.password || null
          : null;
      ok = passwordsMatch(password, expected);
    }

    if (!ok) {
      return jsonError("Invalid email or password", 401);
    }

    const session: AuthSession = {
      uid: user.uid,
      email: user.email,
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      permissions: user.permissions,
    };
    const token = await createDatabaseSession(session);

    const response = jsonOk({ token, session });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (err) {
    if (err instanceof Response) return err;
    return internalErrorResponse(err);
  }
}
