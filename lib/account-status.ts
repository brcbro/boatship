import type { AccountStatus, AppUser } from "@/types";

export const ACCOUNT_STATUSES: AccountStatus[] = ["invited", "active", "suspended", "deactivated"];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as string[]).includes(value);
}

/**
 * Effective status. Records written before the explicit field existed derive
 * it from their credential state: an account that still has to set a password
 * and has none is `invited`, everything else is `active`.
 */
export function accountStatus(user: Pick<AppUser, "status" | "mustResetPassword" | "passwordHash" | "password">): AccountStatus {
  if (user.status) return user.status;
  if (user.mustResetPassword && !user.passwordHash && !user.password) return "invited";
  return "active";
}

/** The one rule every authentication path (login, cookie, MCP, jobs) applies. */
export function accountCanAuthenticate(user: Pick<AppUser, "status" | "mustResetPassword" | "passwordHash" | "password">): boolean {
  return accountStatus(user) === "active" && !user.mustResetPassword;
}

export function currentAuthzVersion(user: Pick<AppUser, "authzVersion">): number {
  return Number.isSafeInteger(user.authzVersion) && (user.authzVersion as number) >= 0 ? (user.authzVersion as number) : 0;
}
