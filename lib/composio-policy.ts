/**
 * Pure policy for Composio connected-app tools: which calls Hodi may run on
 * its own, which need a human approval first, connected-account ownership,
 * and the fixed arguments of the integrations page tests. No network access
 * and no Firestore imports, so it is unit-testable with mocks.
 */
import type { ToolSet } from "ai";

/** Approved connected-app work is stored and executed as this Hodi action. */
export const CONNECTED_APP_ACTION = "run_connected_app_tools" as const;

export type ConnectedToolItem = { toolSlug: string; arguments: Record<string, unknown> };

export type ConnectedToolDecision =
  | { kind: "read" }
  | { kind: "write"; items: ConnectedToolItem[] }
  | { kind: "blocked"; reason: string };

/** Any of these tokens in a slug makes the tool a write tool; writes win over reads. */
const WRITE_TOKENS = new Set([
  "SEND", "POST", "CREATE", "DELETE", "REMOVE", "SHARE", "UPDATE", "MOVE", "INVITE", "ADD", "APPEND", "INSERT",
  "UPLOAD", "EDIT", "MODIFY", "PATCH", "PUT", "REPLY", "FORWARD", "ARCHIVE", "UNARCHIVE", "TRASH", "UNTRASH", "COPY",
  "RENAME", "SET", "UNSET", "ENABLE", "DISABLE", "PUBLISH", "UNPUBLISH", "SCHEDULE", "CANCEL", "APPROVE", "REJECT",
  "MARK", "STAR", "UNSTAR", "LABEL", "TAG", "JOIN", "LEAVE", "KICK", "BAN", "PIN", "UNPIN", "REACT", "CLEAR", "EXECUTE", "RUN", "WRITE", "MERGE", "CLOSE", "OPEN", "START", "STOP", "RESTORE", "EMPTY", "IMPORT", "SYNC",
  "TRANSFER", "GRANT", "REVOKE", "CONNECT", "DISCONNECT", "UPSERT", "REPLACE", "RESET", "SUBMIT", "ASSIGN",
  "UNASSIGN", "COMPLETE", "RESPOND", "ACCEPT", "DECLINE", "DRAFT", "SAVE", "MUTE", "UNMUTE", "SNOOZE", "SPLIT",
  "DUPLICATE", "RESIZE", "FORMAT", "SORT", "CHANGE", "DEPLOY", "TRIGGER", "WATCH", "SUBSCRIBE", "UNSUBSCRIBE",
  "INVOKE", "CALL", "DESTROY", "PURGE", "BLOCK", "UNBLOCK", "CONVERT", "MAKE", "NEW", "GENERATE", "APPLY",
]);

/** Read-only verbs. A slug runs automatically only if it has one and no write token. */
const READ_TOKENS = new Set([
  "GET", "LIST", "FIND", "SEARCH", "FETCH", "READ", "QUERY", "LOOKUP", "RETRIEVE", "DOWNLOAD", "EXPORT", "CHECK",
  "COUNT", "DESCRIBE", "VIEW", "LOOK", "INFO", "DETAILS", "HISTORY", "STATUS", "PREVIEW",
]);

/** Composio meta tools that only search the catalog, read schemas, or start the user's own connection link. */
const READ_META_TOOLS = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS"]);
const MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
const MAX_ITEMS_PER_PROPOSAL = 10;
const MAX_ARGUMENT_CHARS = 50_000;

/** Classifies a provider tool slug such as GMAIL_SEND_EMAIL. Unknown verbs are treated as writes. */
export function classifyConnectedToolSlug(slug: string): "read" | "write" {
  const tokens = slug.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.some((token) => WRITE_TOKENS.has(token))) return "write";
  if (tokens.some((token) => READ_TOKENS.has(token))) return "read";
  return "write";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only tools of the curated toolkits can be proposed or executed after approval. */
export function connectedToolItemError(item: ConnectedToolItem, allowedToolkits: readonly string[]): string | null {
  const slug = item.toolSlug;
  if (!/^[A-Z0-9_]{3,120}$/.test(slug)) return "Connected-app tool names must be Composio tool slugs";
  if (slug.startsWith("COMPOSIO_")) return "Composio session tools cannot run as an approved action";
  if (!allowedToolkits.some((toolkit) => slug.startsWith(`${toolkit.toUpperCase()}_`))) {
    return `${slug} is not part of a connected Boatship toolkit`;
  }
  if (JSON.stringify(item.arguments).length > MAX_ARGUMENT_CHARS) return `${slug} arguments are too large to review`;
  return null;
}

/** Parses and validates a stored or proposed list of connected-app tool calls. */
export function normalizeConnectedToolItems(value: unknown, allowedToolkits: readonly string[]): ConnectedToolItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("At least one connected-app tool is required");
  if (value.length > MAX_ITEMS_PER_PROPOSAL) throw new Error(`At most ${MAX_ITEMS_PER_PROPOSAL} connected-app tools can be approved at once`);
  return value.map((raw) => {
    const record = asRecord(raw);
    const toolSlug = typeof record?.toolSlug === "string" ? record.toolSlug.trim() : "";
    const args = record?.arguments === undefined ? {} : asRecord(record.arguments);
    if (!record || !args) throw new Error("Every connected-app tool needs a slug and an arguments object");
    const unknownKeys = Object.keys(record).filter((key) => key !== "toolSlug" && key !== "arguments");
    if (unknownKeys.length) throw new Error(`Unsupported connected-app tool fields: ${unknownKeys.join(", ")}`);
    const item = { toolSlug, arguments: args };
    const error = connectedToolItemError(item, allowedToolkits);
    if (error) throw new Error(error);
    return item;
  });
}

/**
 * Decides how one model tool call is handled. Read-only calls run directly.
 * Writes become proposals. Anything that cannot be reviewed is blocked.
 */
export function classifyConnectedToolCall(name: string, input: unknown, allowedToolkits: readonly string[]): ConnectedToolDecision {
  if (READ_META_TOOLS.has(name)) return { kind: "read" };
  if (name === MULTI_EXECUTE_TOOL) {
    const tools = asRecord(input)?.tools;
    if (!Array.isArray(tools) || tools.length === 0) return { kind: "blocked", reason: "No connected-app tool calls were supplied" };
    let items: ConnectedToolItem[];
    try {
      items = normalizeConnectedToolItems(tools.map((tool) => {
        const record = asRecord(tool);
        return { toolSlug: typeof record?.tool_slug === "string" ? record.tool_slug : "", arguments: record?.arguments ?? {} };
      }), allowedToolkits);
    } catch (error) {
      return { kind: "blocked", reason: error instanceof Error ? error.message : "Connected-app tool calls are invalid" };
    }
    return items.every((item) => classifyConnectedToolSlug(item.toolSlug) === "read") ? { kind: "read" } : { kind: "write", items };
  }
  if (name.startsWith("COMPOSIO_")) return { kind: "blocked", reason: `${name} is not available in Hodi` };
  if (classifyConnectedToolSlug(name) === "read") return { kind: "read" };
  try {
    return { kind: "write", items: normalizeConnectedToolItems([{ toolSlug: name, arguments: asRecord(input) ?? {} }], allowedToolkits) };
  } catch (error) {
    return { kind: "blocked", reason: error instanceof Error ? error.message : "Connected-app tool call is invalid" };
  }
}

type ExecuteFn = (input: unknown, options: unknown) => unknown;

/**
 * Wraps connected-app tools so only read-only calls execute. Write calls are
 * handed to `propose`, which stores a proposal for explicit approval in the
 * Hodi UI; the model only sees that approval is required.
 */
export function guardConnectedTools<T extends ToolSet>(
  tools: T,
  allowedToolkits: readonly string[],
  propose: (items: ConnectedToolItem[]) => Promise<unknown>,
): T {
  const guarded: Record<string, unknown> = {};
  for (const [name, original] of Object.entries(tools)) {
    const execute = (original as { execute?: ExecuteFn }).execute;
    if (typeof execute !== "function") continue; // Never expose a tool the server cannot gate.
    guarded[name] = {
      ...original,
      execute: async (input: unknown, options: unknown) => {
        const decision = classifyConnectedToolCall(name, input, allowedToolkits);
        if (decision.kind === "read") return execute.call(original, input, options);
        if (decision.kind === "blocked") return { executed: false, approvalRequired: false, error: decision.reason };
        return propose(decision.items);
      },
    };
  }
  return guarded as T;
}

/* ------------------------------------------------------------------ */
/* Connected-account ownership                                         */
/* ------------------------------------------------------------------ */

type ConnectedAccountsClient = {
  connectedAccounts: {
    list(query: { userIds: string[]; cursor?: string | null; limit?: number }): Promise<{ items?: Array<{ id: string }>; nextCursor?: string | null }>;
    delete(id: string): Promise<unknown>;
  };
};

export class ConnectedAccountNotOwnedError extends Error {
  constructor() { super("Connected account not found"); }
}

/** True only when the account id is listed under the caller's own Composio user id. */
export async function ownsConnectedAccount(client: ConnectedAccountsClient, composioUser: string, connectedAccountId: string) {
  let cursor: string | null | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.connectedAccounts.list({ userIds: [composioUser], limit: 100, ...(cursor ? { cursor } : {}) });
    if ((result.items ?? []).some((item) => item.id === connectedAccountId)) return true;
    cursor = result.nextCursor;
    if (!cursor) return false;
  }
  return false;
}

/** Deletes a connected account after checking that it belongs to the caller. */
export async function disconnectOwnedAccount(client: ConnectedAccountsClient, composioUser: string, connectedAccountId: string) {
  if (!connectedAccountId.trim() || !(await ownsConnectedAccount(client, composioUser, connectedAccountId))) {
    throw new ConnectedAccountNotOwnedError();
  }
  await client.connectedAccounts.delete(connectedAccountId);
}

/* ------------------------------------------------------------------ */
/* Integrations page tests                                             */
/* ------------------------------------------------------------------ */

export const INTEGRATION_TEST_MESSAGE = "Boatship connected. Client work updates can post here.";

/**
 * Arguments for the two connection tests on the integrations page are fixed
 * here, so the endpoint cannot send arbitrary content. Only the Slack channel
 * is chosen by the caller.
 */
export function integrationTestArguments(tool: string, input: { channel?: unknown }): Record<string, unknown> | null {
  if (tool === "GOOGLEDRIVE_FIND_FILE") return { pageSize: 5, fields: "id,name,mimeType,webViewLink" };
  if (tool === "SLACK_SEND_MESSAGE") {
    const channel = typeof input.channel === "string" ? input.channel.trim() : "";
    if (!/^#?[A-Za-z0-9._-]{1,80}$/.test(channel)) throw new Error("Enter a Slack channel id or name (e.g. #general or C01234567)");
    return { channel, markdown_text: INTEGRATION_TEST_MESSAGE, unfurl_links: false };
  }
  return null;
}
