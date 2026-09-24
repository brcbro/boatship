import type { WebhookEndpoint } from "@/types";

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
