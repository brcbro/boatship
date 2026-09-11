import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { appBaseUrl } from "@/lib/client-status";

/** Curated onboarding-relevant toolkits (Composio catalog has 250+). */
export const BOATSHIP_TOOLKITS = [
  {
    slug: "googledrive",
    name: "Google Drive",
    description:
      "Each team member connects their own Drive. Create client folders, list files, and share links from the Agent.",
    testTool: "GOOGLEDRIVE_LIST_FILES",
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Notify your team when clients progress through onboarding.",
    testTool: "SLACK_SENDS_A_MESSAGE",
  },
  {
    slug: "gmail",
    name: "Gmail",
    description: "Send onboarding emails from a connected Gmail account.",
    testTool: "GMAIL_SEND_EMAIL",
  },
  {
    slug: "hubspot",
    name: "HubSpot",
    description: "Create or update CRM contacts when clients are invited.",
    testTool: null,
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Push onboarding notes and checklists into Notion.",
    testTool: null,
  },
] as const;

/** Primary toolkit for the Agent UI (per signed-in member). */
export const AGENT_TOOLKITS = ["googledrive"] as const;

export type BoatshipToolkitSlug = (typeof BOATSHIP_TOOLKITS)[number]["slug"];

export type ConnectedToolkit = {
  slug: string;
  name: string;
  description: string;
  connected: boolean;
  connectedAccountId: string | null;
  status: string | null;
  testTool: string | null;
};

export function isComposioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

const TOOLKIT_VERSIONS = {
  slack: "latest",
  gmail: "latest",
  googledrive: "latest",
  hubspot: "latest",
  notion: "latest",
} as const;

let client: Composio | null = null;
let agentClient: Composio<VercelProvider> | null = null;

function requireApiKey() {
  if (!isComposioConfigured()) {
    throw new Error(
      "Composio is not configured. Set COMPOSIO_API_KEY in .env.local (get a key at https://app.composio.dev)."
    );
  }
}

export function getComposio() {
  requireApiKey();
  if (!client) {
    client = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY!,
      toolkitVersions: TOOLKIT_VERSIONS,
    });
  }
  return client;
}

/** Composio client with Vercel AI SDK tool wrapping for the Agent UI. */
export function getAgentComposio(): Composio<VercelProvider> {
  requireApiKey();
  if (!agentClient) {
    agentClient = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY!,
      provider: new VercelProvider(),
      toolkitVersions: TOOLKIT_VERSIONS,
    });
  }
  return agentClient;
}

/**
 * Session scoped to the signed-in member's Drive connection.
 * Reuses their per-user OAuth; agent can prompt Connect Link if missing.
 */
export async function createDriveAgentSession(boatshipUid: string, req?: Request) {
  const composio = getAgentComposio();
  const userId = composioUserId(boatshipUid);
  const callbackUrl = `${appBaseUrl(req)}/integrations?connected=googledrive`;
  return composio.create(userId, {
    toolkits: [...AGENT_TOOLKITS],
    manageConnections: { callbackUrl },
  });
}

/** Stable Composio user id scoped to the signed-in Boatship user. */
export function composioUserId(boatshipUid: string) {
  return `boatship_${boatshipUid}`;
}

export async function listBoatshipConnections(boatshipUid: string): Promise<ConnectedToolkit[]> {
  const composio = getComposio();
  const userId = composioUserId(boatshipUid);
  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    statuses: ["ACTIVE"],
  });

  const byToolkit = new Map<string, { id: string; status: string }>();
  for (const item of accounts.items ?? []) {
    const slug = (item.toolkit?.slug || "").toLowerCase();
    if (!slug) continue;
    byToolkit.set(slug, { id: item.id, status: String(item.status || "ACTIVE") });
  }

  return BOATSHIP_TOOLKITS.map((tk) => {
    const hit = byToolkit.get(tk.slug);
    return {
      slug: tk.slug,
      name: tk.name,
      description: tk.description,
      connected: Boolean(hit),
      connectedAccountId: hit?.id ?? null,
      status: hit?.status ?? null,
      testTool: tk.testTool,
    };
  });
}

export async function startToolkitConnect(
  boatshipUid: string,
  toolkitSlug: string,
  req?: Request
) {
  const composio = getComposio();
  const userId = composioUserId(boatshipUid);
  const callbackUrl = `${appBaseUrl(req)}/integrations?connected=${encodeURIComponent(toolkitSlug)}`;

  // Prefer session authorize (hosted Connect Link + callback).
  const session = await composio.create(userId, {
    toolkits: [toolkitSlug],
    manageConnections: { callbackUrl },
  });
  const connectionRequest = await session.authorize(toolkitSlug);
  return {
    redirectUrl: connectionRequest.redirectUrl,
    connectionId: connectionRequest.id,
  };
}

export async function disconnectAccount(connectedAccountId: string) {
  const composio = getComposio();
  await composio.connectedAccounts.delete(connectedAccountId);
}

export async function executeTool(params: {
  boatshipUid: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
}) {
  const composio = getComposio();
  const userId = composioUserId(params.boatshipUid);
  return composio.tools.execute(params.toolSlug, {
    userId,
    arguments: params.arguments,
    dangerouslySkipVersionCheck: true,
  });
}

export type IntegrationEvent =
  | {
      type: "client.created";
      clientName: string;
      companyName: string;
      clientId: string;
    }
  | {
      type: "client.invited";
      clientName: string;
      companyName: string;
      email: string;
      clientId: string;
    }
  | {
      type: "task.completed";
      clientName: string;
      companyName: string;
      taskTitle: string;
      clientId: string;
    }
  | {
      type: "onboarding.completed";
      clientName: string;
      companyName: string;
      clientId: string;
    };

function clientAdminPath(clientId: string) {
  const base = appBaseUrl().replace(/\/$/, "");
  return `${base}/clients/${clientId}`;
}

function formatEventMessage(event: IntegrationEvent) {
  const link = clientAdminPath(event.clientId);
  switch (event.type) {
    case "client.created":
      return [
        `🆕 *New client created*`,
        `*${event.clientName}* · ${event.companyName}`,
        `Open: ${link}`,
      ].join("\n");
    case "client.invited":
      return [
        `✉️ *Client invited*`,
        `*${event.clientName}* · ${event.companyName}`,
        `Email: ${event.email}`,
        `Open: ${link}`,
      ].join("\n");
    case "task.completed":
      return [
        `✅ *Task completed*`,
        `*${event.taskTitle}*`,
        `${event.clientName} · ${event.companyName}`,
        `Open: ${link}`,
      ].join("\n");
    case "onboarding.completed":
      return [
        `🎉 *Onboarding complete*`,
        `*${event.clientName}* · ${event.companyName}`,
        `Open: ${link}`,
      ].join("\n");
  }
}

function splitContactName(fullName: string): { firstname: string; lastname: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstname: "Contact", lastname: "" };
  if (parts.length === 1) return { firstname: parts[0]!, lastname: "" };
  return { firstname: parts[0]!, lastname: parts.slice(1).join(" ") };
}

function toolSucceeded(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (r.successful === false) return false;
  if (typeof r.error === "string" && r.error.trim()) return false;
  return true;
}

function digHubspotContactId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;

  // Prefer HubSpot search `results[0].id` when present.
  const results = record.results ?? (record.data as Record<string, unknown> | undefined)?.results;
  if (Array.isArray(results) && results[0]) {
    const fromList = digHubspotContactId(results[0]);
    if (fromList) return fromList;
  }

  for (const key of ["id", "vid", "contactId", "contact_id", "hs_object_id"]) {
    const val = record[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const hit = digHubspotContactId(nested);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Soft HubSpot contact create-or-update on invite.
 * Never throws — returns a small status object for logging.
 */
async function upsertHubspotContact(
  boatshipUid: string,
  event: Extract<IntegrationEvent, { type: "client.invited" }>
) {
  const { firstname, lastname } = splitContactName(event.clientName);
  const createArgs: Record<string, unknown> = {
    email: event.email,
    firstname,
    company: event.companyName,
    lifecyclestage: "lead",
  };
  if (lastname) createArgs.lastname = lastname;

  try {
    const created = await executeTool({
      boatshipUid,
      toolSlug: "HUBSPOT_CREATE_CONTACT",
      arguments: createArgs,
    });
    if (toolSucceeded(created)) {
      return { action: "created" as const, result: created };
    }
    console.warn("[composio] hubspot create unsuccessful, trying update", created);
  } catch (createErr) {
    // Duplicate email / other create failure → search + update
    console.warn("[composio] hubspot create failed, trying update", createErr);
  }

  try {
    const search = await executeTool({
      boatshipUid,
      toolSlug: "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
      arguments: {
        query: event.email,
        limit: 1,
        properties: ["email", "firstname", "lastname", "company"],
        filterGroups: [
          {
            filters: [
              { propertyName: "email", operator: "EQ", value: event.email },
            ],
          },
        ],
      },
    });
    const contactId = digHubspotContactId(search);
    if (!contactId) {
      return { action: "skipped" as const, reason: "not_found_after_create_fail" };
    }

    const properties: Record<string, string> = {
      email: event.email,
      firstname,
      company: event.companyName,
    };
    if (lastname) properties.lastname = lastname;

    const updated = await executeTool({
      boatshipUid,
      toolSlug: "HUBSPOT_UPDATE_CONTACT",
      arguments: { contactId, properties },
    });
    return { action: "updated" as const, result: updated, contactId };
  } catch (updateErr) {
    console.error("[composio] hubspot upsert failed", updateErr);
    return {
      action: "error" as const,
      error: updateErr instanceof Error ? updateErr.message : "unknown",
    };
  }
}

/**
 * Best-effort Slack (+ HubSpot on invite) when COMPOSIO_API_KEY + toolkits are connected.
 * Never throws — integrations must not break core onboarding flows.
 */
export async function notifyIntegrations(boatshipUid: string, event: IntegrationEvent) {
  if (!isComposioConfigured()) return { skipped: true as const, reason: "not_configured" };

  try {
    const connections = await listBoatshipConnections(boatshipUid);
    const channel = process.env.COMPOSIO_SLACK_CHANNEL?.trim();
    const slack = connections.find((c) => c.slug === "slack" && c.connected);
    const hubspot = connections.find((c) => c.slug === "hubspot" && c.connected);

    let slackResult: unknown = null;
    let slackSkipped: string | null = null;
    if (!channel) {
      slackSkipped = "no_slack_channel";
    } else if (!slack) {
      slackSkipped = "slack_not_connected";
    } else {
      slackResult = await executeTool({
        boatshipUid,
        toolSlug: "SLACK_SENDS_A_MESSAGE",
        arguments: {
          channel,
          text: formatEventMessage(event),
        },
      });
    }

    let hubspotResult: unknown = null;
    let hubspotSkipped: string | null = null;
    if (event.type === "client.invited") {
      if (!hubspot) {
        hubspotSkipped = "hubspot_not_connected";
      } else {
        hubspotResult = await upsertHubspotContact(boatshipUid, event);
      }
    }

    const didAnything = Boolean(slackResult) || Boolean(hubspotResult);
    return {
      skipped: !didAnything,
      reason: didAnything
        ? undefined
        : slackSkipped || hubspotSkipped || "nothing_connected",
      slack: slackResult ? { ok: true, result: slackResult } : { skipped: true, reason: slackSkipped },
      hubspot:
        event.type === "client.invited"
          ? hubspotResult
            ? { ok: true, result: hubspotResult }
            : { skipped: true, reason: hubspotSkipped }
          : undefined,
    };
  } catch (err) {
    console.error("[composio] notify failed", err);
    return {
      skipped: true as const,
      reason: "error",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
