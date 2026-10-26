/**
 * Builds the conversation Hodi sends to the model. Prior turns come only from
 * the server-stored chat history (text only), so a client cannot inject fake
 * assistant turns or tool results. The request contributes only the text of
 * its latest user message. Pure, so it is unit-testable.
 */
import type { UIMessage } from "ai";

export const MAX_USER_MESSAGE_CHARS = 12_000;
/** Older turns are dropped until the whole history fits this budget. */
export const MAX_HISTORY_CHARS = 48_000;
/** A single stored turn is cut to this size before budgeting. */
export const MAX_STORED_TURN_CHARS = 12_000;
/** Per-step cap on generated tokens. */
export const MAX_OUTPUT_TOKENS = 4_096;

type StoredTurn = { id: string; role: "user" | "assistant"; text: string };
type RequestPart = { type?: unknown; text?: unknown };
type RequestMessage = { id?: unknown; role?: unknown; parts?: unknown };

/** Text of the last user message in the request; every other part and message is ignored. */
export function latestUserRequest(messages: unknown): { id: string | null; text: string } | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as RequestMessage | null;
    if (!message || message.role !== "user") continue;
    const parts = Array.isArray(message.parts) ? message.parts as RequestPart[] : [];
    const text = parts
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join(" ")
      .trim();
    const id = typeof message.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(message.id) ? message.id : null;
    return { id, text };
  }
  return null;
}

/**
 * The id to store the new user message under. A client id is reused so a
 * retried send does not duplicate the turn, but it can never overwrite a
 * stored assistant turn.
 */
export function userMessageId(requestedId: string | null, history: StoredTurn[], newId: () => string) {
  if (!requestedId) return newId();
  return history.some((turn) => turn.id === requestedId && turn.role !== "user") ? newId() : requestedId;
}

function clip(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Keeps the newest stored turns that fit the character budget; the newest turn is always kept. */
export function budgetedConversation(history: StoredTurn[], maxChars = MAX_HISTORY_CHARS): UIMessage[] {
  const kept: UIMessage[] = [];
  let used = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    const text = clip(turn.text, MAX_STORED_TURN_CHARS);
    if (kept.length > 0 && used + text.length > maxChars) break;
    used += text.length;
    kept.unshift({ id: turn.id, role: turn.role, parts: [{ type: "text", text }] });
  }
  // A model conversation must start with a user turn.
  while (kept.length > 1 && kept[0]!.role !== "user") kept.shift();
  return kept;
}
