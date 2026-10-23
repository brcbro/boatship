import type { AuthSession, StaffPermission, UserRole } from "@/types";

/** Defaults apply only when permissions are omitted. An explicit [] denies all. */
export const DEFAULT_TEAM_PERMISSIONS: StaffPermission[] = [
  "clients.view",
  "clients.manage",
  "documents.review",
  "forms.review",
  "analytics.view",
];

export const ALL_STAFF_PERMISSIONS: StaffPermission[] = [
  "clients.manage",
  "clients.view",
  "documents.review",
  "forms.review",
  "templates.manage",
  "team.manage",
  "integrations.manage",
  "analytics.view",
  "webhooks.manage",
  "audit.export",
];

/** These management routes also require the admin role. */
export const ADMIN_ONLY_STAFF_PERMISSIONS: StaffPermission[] = [
  "templates.manage",
  "webhooks.manage",
];

export function parseStaffPermissions(value: unknown): StaffPermission[] {
  if (!Array.isArray(value) || value.some((item) => !ALL_STAFF_PERMISSIONS.includes(item))) {
    throw new Error("permissions must be an array of known staff permissions");
  }
  return [...new Set(value)] as StaffPermission[];
}

/** A concrete list for display without confusing defaults with revoked access. */
export function effectiveStaffPermissions(session: Pick<AuthSession, "role" | "permissions">): StaffPermission[] {
  if (session.role === "admin") return [...ALL_STAFF_PERMISSIONS];
  if (session.role !== "team") return [];
  if (session.permissions === undefined) return [...DEFAULT_TEAM_PERMISSIONS];
  return Array.isArray(session.permissions)
    ? session.permissions.filter((permission) => ALL_STAFF_PERMISSIONS.includes(permission))
    : [];
}

export function isStaff(role: UserRole) {
  return role === "admin" || role === "team";
}

export function canManageTemplates(role: UserRole) {
  return role === "admin";
}

export function homePathForRole(role: UserRole) {
  if (role === "client") return "/portal";
  return "/dashboard";
}

/** Admin has all permissions; team uses explicit list or defaults. */
export function hasPermission(session: AuthSession, perm: StaffPermission): boolean {
  return effectiveStaffPermissions(session).includes(perm);
}

export function requireStaffPermission(session: AuthSession, permission: StaffPermission): void {
  if (hasPermission(session, permission)) return;
  throw new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

type PermissionRule = { anyOf: StaffPermission[] };

/**
 * Each authenticated HTTP entry point uses this policy before accessing data.
 * Existing role checks and current client assignment remain separate requirements.
 * A review grant permits its own resource reads without general clients.view.
 */
export function staffRequestPermissionRules(url: string, method: string): PermissionRule[] {
  const path = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, "");
  const read = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  const needs = (...permissions: StaffPermission[]): PermissionRule[] => permissions.map((permission) => ({ anyOf: [permission] }));
  const inArea = (area: string) => path === `/api/${area}` || path.startsWith(`/api/${area}/`);

  // Personal account endpoints are available to every signed-in staff member,
  // including a team user with an explicit empty capability list; each one
  // scopes its data to the session's own uid.
  if (inArea("account")) return [];
  if (inArea("audit") || inArea("gdpr")) return needs("audit.export");
  if (inArea("analytics")) return needs("analytics.view");
  if (inArea("integrations") || inArea("settings/secrets")) return needs("integrations.manage");
  if (inArea("webhooks") && !inArea("webhooks/git")) return needs("webhooks.manage");
  if (inArea("users")) return read ? [] : needs("team.manage");
  if (inArea("templates") || inArea("forms/templates")) return read ? [] : needs("templates.manage");

  if (inArea("documents")) {
    if (read) return [{ anyOf: ["clients.view", "documents.review"] }];
    if (path === "/api/documents/bulk" || (method.toUpperCase() === "PATCH" && /^\/api\/documents\/[^/]+$/.test(path))) {
      return needs("documents.review");
    }
    return needs("clients.manage");
  }
  if (inArea("forms")) {
    if (/^\/api\/forms\/[^/]+\/review$/.test(path)) return needs("forms.review");
    if (read) return [{ anyOf: ["clients.view", "forms.review"] }];
    return needs("clients.manage");
  }
  if (path === "/api/calendar") return needs(read ? "clients.view" : "integrations.manage");
  if (path === "/api/messages/live-ticket") return needs("clients.view");
  if (inArea("clients") || inArea("engagements") || inArea("tasks") || inArea("vessels") || inArea("messages") || inArea("project-operations") || inArea("smart-lists") || inArea("reminders")) {
    return needs(read ? "clients.view" : "clients.manage");
  }
  if (inArea("activity") || inArea("dashboard") || inArea("search") || inArea("onboarding-health") || inArea("reports")) return needs("clients.view");
  if (inArea("notify") || inArea("digests") || inArea("automations")) return needs(read ? "clients.view" : "clients.manage");
  if (inArea("git")) return needs(read ? "clients.view" : "clients.manage");
  if (inArea("mcp/approvals")) return needs(read ? "clients.view" : "clients.manage");
  if (inArea("agent/communications") || inArea("hodi/queue")) return needs(read ? "clients.view" : "clients.manage");
  if (inArea("agent/insights") || inArea("agent/chat")) return needs("clients.view");

  // Product membership, personal settings, MCP token controls, own Hodi action
  // proposals/history, and authenticated capabilities not listed here keep
  // their existing domain-specific controls. Add new areas explicitly above.
  return [];
}

export function requireStaffRequestPermissions(session: AuthSession, req: Pick<Request, "url" | "method">): void {
  if (session.role !== "team") return;
  const allowed = staffRequestPermissionRules(req.url, req.method).every((rule) => rule.anyOf.some((permission) => hasPermission(session, permission)));
  if (allowed) return;
  throw new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/** MCP token scopes cannot replace the owner's current staff permissions. */
export function staffCanUseMcpScope(session: AuthSession, scope: string): boolean {
  if (session.role !== "team" || scope === "session:read") return true;
  return hasPermission(session, scope === "tasks:write" || scope === "git:validate" ? "clients.manage" : "clients.view");
}
