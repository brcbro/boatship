import { randomBytes, randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { inviteEmailHtml, sendEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";
import { DEFAULT_TEAM_PERMISSIONS } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import type { StaffPermission, UserRole } from "@/types";

export const runtime = "nodejs";

/** Local/demo invite password — same as client invites for demo login. */
const TEMP_PASSWORD = "Welcome123!";

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      role?: UserRole;
      permissions?: StaffPermission[];
    };

    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const role = body.role;

    if (!email || !name) throw jsonError("email and name are required", 400);
    if (role !== "admin" && role !== "team") {
      throw jsonError("role must be admin or team", 400);
    }

    const store = await getStore();
    const existing = await store.getUserByEmail(email);
    if (existing && existing.role === "client") {
      throw jsonError("A client user already exists with this email", 400);
    }
    if (existing && (existing.role === "admin" || existing.role === "team")) {
      throw jsonError("A team member with this email already exists", 400);
    }

    const inviteToken = randomBytes(24).toString("hex");
    const inviteTokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const permissions =
      role === "team"
        ? Array.isArray(body.permissions) && body.permissions.length > 0
          ? body.permissions
          : [...DEFAULT_TEAM_PERMISSIONS]
        : undefined;

    const user = await store.upsertUser({
      uid: existing?.uid || randomUUID(),
      email,
      name,
      role,
      clientId: null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      inviteToken,
      inviteTokenExpiresAt,
      mustResetPassword: true,
      password: null,
      passwordHash: hashPassword(TEMP_PASSWORD),
      permissions,
    });

    const loginUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(inviteToken)}`;
    await sendEmail({
      to: email,
      subject: "You're invited to Boatship",
      html: inviteEmailHtml({
        name,
        companyName: "Boatship",
        loginUrl,
        tempPassword: TEMP_PASSWORD,
        ctaLabel: "Set your password & sign in",
      }),
    });

    return {
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions || [],
      },
      tempPassword: TEMP_PASSWORD,
      loginUrl,
      inviteToken,
    };
  });
}
