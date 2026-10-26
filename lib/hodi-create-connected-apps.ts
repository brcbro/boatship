import type { AuthSession } from "@/types";
import { hasPermission } from "@/lib/rbac";
import { AGENT_TOOLKITS, BOATSHIP_TOOLKITS, executeTool, isComposioConfiguredForUser } from "@/lib/composio";
import { classifyConnectedToolSlug, normalizeConnectedToolItems, type ConnectedToolItem } from "@/lib/composio-policy";
import { integrationProviderConfirmed } from "@/lib/integration-job-policy";

type Payload = Record<string, unknown>;

function toolkitName(slug: string) {
  return BOATSHIP_TOOLKITS.find((toolkit) => slug.startsWith(`${toolkit.slug.toUpperCase()}_`))?.name || "Connected app";
}

function argumentValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function validate(payload: Payload, session: AuthSession): Promise<ConnectedToolItem[]> {
  if (!hasPermission(session, "integrations.manage")) throw new Error("Forbidden");
  if (!(await isComposioConfiguredForUser(session.uid))) throw new Error("Composio is not configured for this user or the server");
  return normalizeConnectedToolItems(payload.tools, AGENT_TOOLKITS);
}

/** Preview of connected-app calls. Every argument the provider receives is listed. */
export async function previewConnectedAppAction(payload: Payload, session: AuthSession) {
  const items = await validate(payload, session);
  const first = items[0]!;
  return {
    title: items.length === 1
      ? `Run ${first.toolSlug} in ${toolkitName(first.toolSlug)}`
      : `Run ${items.length} connected-app actions`,
    changes: [
      ...items.map((item) => `${item.toolSlug} (${toolkitName(item.toolSlug)}, ${classifyConnectedToolSlug(item.toolSlug) === "read" ? "read-only" : "may send, share, or change data"})`),
      "Runs with your own connected account. Messages, invitations, or shares may be visible to people outside Boatship.",
    ],
    diff: items.flatMap((item, index) => {
      const entries = Object.entries(item.arguments);
      const prefix = items.length > 1 ? `${index + 1}. ${item.toolSlug}` : item.toolSlug;
      if (!entries.length) return [{ field: `${index}.arguments`, label: prefix, before: "Not run", after: "No arguments" }];
      return entries.map(([key, value]) => ({ field: `${index}.${key}`, label: `${prefix} · ${key}`, before: "Not run", after: argumentValue(value) }));
    }),
  };
}

/**
 * Runs the approved calls in order. Any unconfirmed provider result stops the
 * run; earlier calls may already have taken effect, so the caller marks the
 * proposal failed rather than retryable.
 */
export async function executeConnectedAppAction(payload: Payload, session: AuthSession) {
  const items = await validate(payload, session);
  const results: Array<{ toolSlug: string; successful: true }> = [];
  for (const item of items) {
    const result = await executeTool({ boatshipUid: session.uid, toolSlug: item.toolSlug, arguments: item.arguments });
    if (!integrationProviderConfirmed(result)) {
      const done = results.length ? ` ${results.map((entry) => entry.toolSlug).join(", ")} already ran.` : "";
      throw new Error(`${item.toolSlug} did not complete.${done}`);
    }
    results.push({ toolSlug: item.toolSlug, successful: true });
  }
  return { results };
}
