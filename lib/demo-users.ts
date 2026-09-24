import type { AppUser } from "@/types";
import { verifyPassword } from "@/lib/password";

/** Reject legacy fixed-password demo accounts that may already exist in a hosted database. */
export function isUnsafeDemoUser(user: AppUser) {
  if (process.env.NODE_ENV !== "production") return false;
  const expected = user.uid === "seed_admin" && user.email === "admin@boatship.local"
    ? "admin123"
    : user.uid === "seed_team" && user.email === "team@boatship.local"
      ? "team123"
      : null;
  return Boolean(expected && user.passwordHash && verifyPassword(expected, user.passwordHash));
}
