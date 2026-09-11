import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export function isLlmConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.AI_GATEWAY_API_KEY?.trim());
}

/** Prefer direct OpenAI when OPENAI_API_KEY is set; otherwise AI Gateway string model. */
export function getAgentModel(): LanguageModel | string {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openai(process.env.OPENAI_AGENT_MODEL?.trim() || "gpt-4o-mini");
  }
  if (process.env.AI_GATEWAY_API_KEY?.trim()) {
    return process.env.AI_GATEWAY_MODEL?.trim() || "openai/gpt-4o-mini";
  }
  throw new Error(
    "No LLM configured. Set OPENAI_API_KEY (or AI_GATEWAY_API_KEY) in .env.local."
  );
}

export const DRIVE_AGENT_SYSTEM = `You are Boatship's Drive assistant for client onboarding staff.
You help the signed-in team member work with THEIR Google Drive via Composio tools.

Capabilities (Google Drive only):
- List, search, and summarize files/folders
- Create folders for clients (e.g. "Client — Company Name")
- Upload or move onboarding docs when the tools allow it
- Share links and report folder structure clearly

Rules:
- Only use Google Drive tools available in this session.
- If Drive is not connected, share the Connect Link and ask them to connect, then continue.
- Ask before deleting, overwriting, or changing sharing permissions.
- Prefer clear, concise answers for onboarding ops (folder names, links, what you did).
- Do not invent file IDs or share links — only use tool results.`;
