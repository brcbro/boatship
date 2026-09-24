import type { AuthSession, StaffPermission, UserRole } from "@/types";

/** Default permissions for team members when none are explicitly set. */
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
  if (session.role === "admin") return true;
  if (session.role !== "team") return false;
  const perms =
    session.permissions && session.permissions.length > 0
      ? session.permissions
      : DEFAULT_TEAM_PERMISSIONS;
  return perms.includes(perm);
}
