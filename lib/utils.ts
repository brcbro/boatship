import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MS_PER_DAY = 86_400_000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a calendar date without a time, such as a task due date. */
export function isDateOnly(value: string) {
  return DATE_ONLY.test(value);
}

/**
 * Parses a stored date. A `YYYY-MM-DD` value is a calendar day, so it becomes
 * local midnight: `new Date("2026-10-26")` is UTC midnight and shows the
 * previous day west of UTC.
 */
export function parseDateValue(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
}

/** A local calendar date as `YYYY-MM-DD`. */
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Average of durations in milliseconds, in days rounded to one decimal place; 0 when empty. */
export function averageDurationDays(durationsMs: readonly number[]) {
  if (!durationsMs.length) return 0;
  const total = durationsMs.reduce((sum, value) => sum + value, 0);
  return Math.round((total / durationsMs.length / MS_PER_DAY) * 10) / 10;
}

type OnboardingRow = { type: string; status: string; completedAt?: string | null; startDate?: string | null; createdAt: string };
type ClientRow = { status: string; createdAt: string; updatedAt: string };

/**
 * Average days from start to completion of completed onboarding engagements.
 * Without any, falls back to created-to-updated time of completed clients.
 */
export function averageOnboardingDays(engagements: readonly OnboardingRow[], clients: readonly ClientRow[]) {
  const completed = engagements.filter((item) => item.type === "onboarding" && item.status === "completed" && item.completedAt);
  if (completed.length) {
    return averageDurationDays(completed.map((item) => new Date(item.completedAt!).getTime() - new Date(item.startDate || item.createdAt).getTime()));
  }
  return averageDurationDays(
    clients.filter((client) => client.status === "completed").map((client) => new Date(client.updatedAt).getTime() - new Date(client.createdAt).getTime())
  );
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function calcProgress(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

export function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Path prefixes of the staff workspace. Keep in step with ADMIN_PATHS in proxy.ts. */
export const STAFF_PATH_PREFIXES = [
  "/dashboard", "/settings", "/clients", "/team", "/workload", "/projects",
  "/products", "/workspace", "/calendar", "/messages", "/templates",
  "/forms", "/analytics", "/accounting", "/integrations", "/webhooks",
  "/mcp", "/compliance", "/hodi", "/automations", "/agent",
  "/tasks", "/reminders", "/account",
] as const;

function underPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

const PROBE_ORIGIN = "https://boatship.invalid";

/**
 * The post-sign-in destination from `?next=`, when it is a same-origin relative
 * path in the area the role may open: staff paths for admin and team, `/portal`
 * for clients. Absolute or protocol-relative URLs, backslashes, control
 * characters and the other role's area return null.
 */
export function safeNextPath(next: string | null | undefined, role: "admin" | "team" | "client"): string | null {
  if (!next || next.length > 2048) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  // Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" is protocol-relative.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  const allowed = role === "client"
    ? underPrefix(url.pathname, "/portal")
    : STAFF_PATH_PREFIXES.some((prefix) => underPrefix(url.pathname, prefix));
  return allowed ? `${url.pathname}${url.search}${url.hash}` : null;
}
