import { handleApi, jsonError } from "@/lib/api";
import { AccountError, inviteAccount, STAFF_INVITATION_TTL_MS } from "@/lib/accounts";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { emailDeliveryConfigured, teamInviteEmailHtml } from "@/lib/email";
import { DEFAULT_TEAM_PERMISSIONS, effectiveStaffPermissions, parseStaffPermissions } from "@/lib/rbac";
import { consumeAccountAndIpLimit, consumeRateLimit } from "@/lib/rate-limit";
import type { UserRole } from "@/types";

export const runtime = "nodejs";

/**
 * Invite a staff member (admin only). The account, its email claim, the
 * hashed setup link, the audit event and the mail intent commit together;
 * the email is sent afterwards. A failed send is reported as such and leaves
 * the record ready for a new invitation of the same address.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    if (!emailDeliveryConfigured()) throw jsonError("Email delivery is not configured", 503);
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      name?: string;
      role?: UserRole;
      permissions?: unknown;
    };

    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const role = body.role;

    if (!email || !name) throw jsonError("email and name are required", 400);
    if (!(await consumeAccountAndIpLimit({ scope: "team-invite", account: email, req, accountMax: 5, ipMax: 40, windowSeconds: 3600 }))) {
      throw jsonError("Too many invitations. Try again later.", 429);
    }
    if (!(await consumeRateLimit({ scope: "team-invite:actor", identity: session.uid, max: 40, windowSeconds: 3600 }))) {
      throw jsonError("Too many invitations. Try again later.", 429);
    }
    if (role !== "admin" && role !== "team") {
      throw jsonError("role must be admin or team", 400);
    }

    let explicitPermissions;
    if (body.permissions !== undefined) {
      try { explicitPermissions = parseStaffPermissions(body.permissions); }
      catch { throw jsonError("permissions must be an array of known staff permissions", 400); }
    }
    const permissions = role === "team" ? explicitPermissions ?? [...DEFAULT_TEAM_PERMISSIONS] : undefined;

    let result;
    try {
      result = await inviteAccount({
        actor: session,
        email,
        name,
        role,
        clientId: null,
        permissions,
        ttlMs: STAFF_INVITATION_TTL_MS,
        resolveExisting: (existing) => {
          if (existing.role === "client") throw new AccountError("A client user already exists with this email", 400, "email_conflict");
          throw new AccountError("A team member with this email already exists", 400, "email_conflict");
        },
        buildEmail: ({ token }) => ({
          to: email,
          subject: "You're invited to Boatship",
          senderName: "Boatship Team",
          html: teamInviteEmailHtml({ name, role, loginUrl: `${appBaseUrl(req)}/login?reset=${encodeURIComponent(token)}` }),
        }),
      });
    } catch (error) {
      if (error instanceof AccountError) throw jsonError(error.message, error.status);
      throw error;
    }

    if (result.delivery.status === "failed") {
      throw jsonError("The invitation was saved but the email could not be sent. Invite again to retry.", 502);
    }

    const { user } = result;
    return {
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
        effectivePermissions: effectiveStaffPermissions(user),
      },
      invitationSent: true,
    };
  });
}
