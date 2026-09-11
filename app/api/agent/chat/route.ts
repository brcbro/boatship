import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { randomUUID } from "crypto";
import type { AgentChatMessage } from "@/types";
import { BOATSHIP_AGENT_SYSTEM, getAgentModel, isLlmConfigured } from "@/lib/agent";
import { jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { buildBoatshipRagContext } from "@/lib/boatship-rag";
import { createBoatshipAgentSession, isComposioConfigured } from "@/lib/composio";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

function getStreamErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("rate-limited") ||
    normalized.includes("rate limit") ||
    normalized.includes("status 429")
  ) {
    return "The free AI service is busy right now. Please try again in a moment.";
  }

  if (normalized.includes("unavailable tool") || normalized.includes("nosuchtool")) {
    return "That connected-app action was not available in this session. Please try again; Hodi will look up the supported action first.";
  }

  return "Hodi could not complete that request. Please try again.";
}

function latestUserText(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "Boatship operational overview";
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function withPersistedHistory(messages: UIMessage[], history: AgentChatMessage[]) {
  const persisted = history.map(
    (message): UIMessage => ({
      id: message.id,
      role: message.role,
      parts: [{ type: "text", text: message.text }],
    })
  );
  const byId = new Map<string, UIMessage>();
  for (const message of [...persisted, ...messages]) byId.set(message.id, message);
  return [...byId.values()].slice(-40);
}

export async function POST(req: Request) {
  try {
    const session = await requireRoles(req, ["admin", "team"]);

    if (!isLlmConfigured()) {
      return jsonError("OPENROUTER_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY is not set", 503);
    }

    const body = (await req.json()) as { messages?: UIMessage[]; sessionId?: string };
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError("messages are required", 400);
    }

    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) return jsonError("a user message is required", 400);

    const store = await getStore();
    const chatSession = body.sessionId
      ? await store.getAgentChatSession(body.sessionId, session.uid)
      : null;
    if (!chatSession) return jsonError("Select or create a chat session first", 400);
    const userText = messageText(latestUserMessage);
    if (!userText) return jsonError("a text message is required", 400);
    const userMessageId = latestUserMessage.id?.trim() || randomUUID();
    await store.upsertAgentChatMessage({
      id: userMessageId,
      userId: session.uid,
      sessionId: chatSession.id,
      role: "user",
      text: userText,
    });
    const conversationMessages = withPersistedHistory(
      messages,
      await store.listAgentChatMessages(session.uid, chatSession.id)
    );

    let composioSession: Awaited<ReturnType<typeof createBoatshipAgentSession>> | null = null;
    let tools = {};
    let composioInstructions: string | undefined;
    if (isComposioConfigured()) {
      try {
        composioSession = await createBoatshipAgentSession(session.uid, req);
        tools = await composioSession.tools();
        composioInstructions = composioSession.experimental.assistivePrompt;
      } catch (error) {
        console.error("[agent/chat composio]", error);
      }
    }
    const ragContext = await buildBoatshipRagContext(latestUserText(conversationMessages), session);

    const result = streamText({
      model: getAgentModel(),
      system: [
        BOATSHIP_AGENT_SYSTEM,
        composioSession
          ? "Connected-app tools are available for the signed-in staff user. Use them only when they materially help the request."
          : "Connected-app tools are unavailable right now. Continue using the supplied Boatship context and explain that an integration may need reconnecting for external actions.",
        "Retrieved Boatship context for the current request:\n" + ragContext,
        composioInstructions,
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: await convertToModelMessages(conversationMessages),
      tools,
      stopWhen: stepCountIs(12),
    });

    return result.toUIMessageStreamResponse({
      onFinish: async ({ responseMessage }) => {
        const text = messageText(responseMessage);
        if (!text) return;
        await store.upsertAgentChatMessage({
          id: responseMessage.id?.trim() || randomUUID(),
          userId: session.uid,
          sessionId: chatSession.id,
          role: "assistant",
          text,
        });
      },
      onError: (error) => {
        console.error("[agent/chat stream]", error);
        return getStreamErrorMessage(error);
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : "Agent request failed";
    console.error("[agent/chat]", message, err);
    return jsonError(message, 500);
  }
}
