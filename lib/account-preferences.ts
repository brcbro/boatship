import type { HourCycle } from "@/types";

/*
 * Personal display preferences (plan phase 1). Stored as fields on the user
 * profile and read back through `/api/account/preferences`. Null means
 * "follow the device". Timestamps are always stored in UTC; these settings
 * only change how account pages render them.
 */

export const HOUR_CYCLES: HourCycle[] = ["12h", "24h"];

export function isHourCycle(value: unknown): value is HourCycle {
  return value === "12h" || value === "24h";
}

/** Accepts only IANA names the runtime can format with; the browser suggests one, the server verifies it. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type AccountPreferences = { timezone: string | null; hourCycle: HourCycle | null };

export const PREFERENCE_FIELDS = ["timezone", "hourCycle"] as const;

/** Formats a stored UTC timestamp for an account page using the person's saved preferences. */
export function formatAccountDateTime(value: string | null | undefined, preferences: Partial<AccountPreferences> | null | undefined, style: "datetime" | "date" = "datetime") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const options: Intl.DateTimeFormatOptions = style === "date" ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
  if (preferences?.hourCycle && style === "datetime") options.hour12 = preferences.hourCycle === "12h";
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, ...(preferences?.timezone ? { timeZone: preferences.timezone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}
