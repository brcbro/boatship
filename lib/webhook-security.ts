import { createHmac } from "crypto";
import type { AppUser, AuthSession, WebhookEndpoint, WebhookEvent } from "@/types";
import { accountCanAuthenticate } from "@/lib/account-status";

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  "client.created",
  "client.completed",
  "client.invited",
  "task.completed",
  "task.overdue",
  "document.approved",
  "document.rejected",
  "form.submitted",
];

/** A de-duplicated list of known events, or null when any entry is unknown. */
export function parseWebhookEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value)) return null;
  const out: WebhookEvent[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !WEBHOOK_EVENTS.includes(item as WebhookEvent)) return null;
    if (!out.includes(item as WebhookEvent)) out.push(item as WebhookEvent);
  }
  return out;
}

/**
 * X-Boatship-Signature is hex HMAC-SHA256(secret, `${timestamp}.${body}`), where
 * timestamp is the X-Boatship-Timestamp header (Unix seconds). Receivers recompute
 * it over the raw body, compare in constant time, and reject stale timestamps.
 */
export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** The owning uid; subscriptions created before `ownerId` existed encode it in `MCP:<uid>:<id>` names. */
export function webhookOwnerId(hook: Pick<WebhookEndpoint, "ownerId" | "name">): string | null {
  if (hook.ownerId) return hook.ownerId;
  const legacy = typeof hook.name === "string" ? /^MCP:([^:]+):/.exec(hook.name) : null;
  return legacy?.[1] ?? null;
}

/**
 * Owned hooks (MCP subscriptions) deliver only what their owner may read: the
 * owner must still be active staff and the event must name a client. Returns the
 * session and client to check, or null when the delivery must be withheld.
 * Hooks without an owner are admin-managed and receive every subscribed event.
 */
export function webhookOwnerScope(
  owner: Pick<AppUser, "uid" | "email" | "name" | "role" | "clientId" | "permissions" | "status" | "mustResetPassword" | "passwordHash" | "password"> | null,
  payload: Record<string, unknown>,
): { session: AuthSession; clientId: string } | null {
  if (!owner || (owner.role !== "admin" && owner.role !== "team") || !accountCanAuthenticate(owner)) return null;
  const clientId = typeof payload.clientId === "string" ? payload.clientId : "";
  if (!clientId) return null;
  return {
    session: { uid: owner.uid, email: owner.email, name: owner.name, role: owner.role, clientId: owner.clientId, permissions: owner.permissions },
    clientId,
  };
}

// Exact origins are configured by the operator, not by the webhook creator.
// No wildcard hosts or IP literals: those can include private services or change ownership.
export function allowedWebhookOrigins(): Set<string> {
  const configured = process.env.WEBHOOK_ALLOWED_ORIGINS ?? "";
  return new Set(configured.split(",").map((entry) => entry.trim()).filter(Boolean));
}

export function validateWebhookUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "url must be a valid HTTPS URL";
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal") ||
    url.hostname === "localhost" ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    url.hostname.includes(":")
  ) {
    return "url must use a public HTTPS hostname without credentials, a port, or a fragment";
  }

  if (!allowedWebhookOrigins().has(url.origin)) {
    return "url origin is not in WEBHOOK_ALLOWED_ORIGINS";
  }
  return null;
}

export type PublicWebhook = Omit<WebhookEndpoint, "secret"> & { hasSecret: boolean };

export function publicWebhook(hook: WebhookEndpoint): PublicWebhook {
  const { secret, ...rest } = hook;
  return { ...rest, hasSecret: Boolean(secret) };
}
