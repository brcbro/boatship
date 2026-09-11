import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { DRIVE_AGENT_SYSTEM, getAgentModel, isLlmConfigured } from "@/lib/agent";
import { jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createDriveAgentSession, isComposioConfigured } from "@/lib/composio";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await requireRoles(req, ["admin", "team"]);

    if (!isComposioConfigured()) {
      return jsonError("COMPOSIO_API_KEY is not set", 503);
    }
    if (!isLlmConfigured()) {
      return jsonError("OPENAI_API_KEY (or AI_GATEWAY_API_KEY) is not set", 503);
    }

    const body = (await req.json()) as { messages?: UIMessage[] };
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError("messages are required", 400);
    }

    const composioSession = await createDriveAgentSession(session.uid, req);
    const tools = await composioSession.tools();

    const result = streamText({
      model: getAgentModel(),
      system: DRIVE_AGENT_SYSTEM,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(12),
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : "Agent request failed";
    console.error("[agent/chat]", message, err);
    return jsonError(message, 500);
  }
}
