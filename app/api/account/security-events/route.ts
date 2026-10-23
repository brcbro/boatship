import { handleApi } from "@/lib/api";
import { listAccountAuditEvents } from "@/lib/accounts";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Audit actions a person may see about their own account, with the label shown. Anything else stays internal. */
const VISIBLE_ACTIONS: Record<string, string> = {
  "credential.password.changed": "Password changed",
  "credential.password_reset.issued": "Password reset link requested",
  "credential.password_reset.redeemed": "Password reset completed",
  "credential.password_reset.denied": "Password reset refused",
  "credential.invite.redeemed": "Account set up from an invitation",
  "credential.invite.denied": "Invitation link refused",
  "invitation.created": "Invitation sent",
  "invitation.resent": "Invitation sent again",
  "session.revoked": "A session was signed out",
  "session.revoked.current": "This device was signed out",
  "sessions.revoked.others": "Other sessions were signed out",
  "account.status.active": "Account activated",
  "account.status.suspended": "Account suspended",
  "account.status.deactivated": "Account deactivated",
  "staff.permissions.changed": "Capabilities changed",
  "account.request.access.created": "Access request submitted",
  "account.request.export.created": "Data export request submitted",
  "account.request.deactivation.created": "Deactivation request submitted",
};

export type SecurityEvent = {
  id: string;
  action: string;
  label: string;
  result: "ok" | "denied" | "failed";
  /** Who did it, without naming another person: you, an administrator, other staff, or the system. */
  by: "you" | "administrator" | "staff" | "system";
  createdAt: string;
};

/**
 * The person's own security activity, newest first. Only a fixed set of
 * actions is shown and only safe fields leave the server: no reasons written
 * by administrators, no metadata, no actor identities beyond their role.
 */
export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const requested = Number.parseInt(url.searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;
    const before = url.searchParams.get("before");
    const cursor = before && !Number.isNaN(new Date(before).getTime()) ? before : null;

    // Fetch one extra so the response can say whether an older page exists.
    const records = await listAccountAuditEvents(session.uid, { limit: limit + 1, before: cursor });
    const page = records.slice(0, limit);
    const events: SecurityEvent[] = page
      .filter((event) => event.action in VISIBLE_ACTIONS)
      .map((event) => ({
        id: event.id,
        action: event.action,
        label: VISIBLE_ACTIONS[event.action],
        result: event.result,
        by: event.actorId === session.uid ? "you" : event.actorRole === "system" || event.actorRole === null ? "system" : event.actorRole === "admin" ? "administrator" : "staff",
        createdAt: event.createdAt,
      }));
    const last = page[page.length - 1];
    return { events, nextBefore: records.length > limit && last ? last.createdAt : null };
  }, NO_STORE);
}
