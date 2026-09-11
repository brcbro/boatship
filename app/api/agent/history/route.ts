import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return { sessions: await store.listAgentChatSessions(session.uid) };
    const chatSession = await store.getAgentChatSession(sessionId, session.uid);
    if (!chatSession) throw jsonError("Chat session not found", 404);
    const messages = await store.listAgentChatMessages(session.uid, sessionId);
    const orderedMessages = [...messages].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    return {
      session: chatSession,
      messages: orderedMessages,
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const store = await getStore();
    return { session: await store.createAgentChatSession(session.uid, body.title) };
  });
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) throw jsonError("sessionId is required", 400);
    const store = await getStore();
    await store.deleteAgentChatSession(sessionId, session.uid);
    return { ok: true };
  });
}
