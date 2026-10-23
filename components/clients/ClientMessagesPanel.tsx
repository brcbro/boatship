"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useMessagePolling } from "@/components/shared/useMessagePolling";
import { useMessageRealtime } from "@/components/shared/useMessageRealtime";
import { Button, Card, Dropdown, EmptyState, Label, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { messageMatchesContext } from "@/lib/message-context";
import { cn, formatDateTime } from "@/lib/utils";
import type { PortalMessage } from "@/types";

type EngagementOption = { id: string; name: string; status: string };

function uniqueMessages(messages: PortalMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => !seen.has(message.id) && Boolean(seen.add(message.id)));
}

/**
 * The client's portal thread inside the client record. Same `/api/messages`
 * reads and writes as the Messages page, scoped to one client; the full page
 * remains the place for cross-client work.
 */
export function ClientMessagesPanel({ clientId, clientName, engagements }: { clientId: string; clientName: string; engagements: EngagementOption[] }) {
  const { session, token } = useAuth();
  const [engagementId, setEngagementId] = useState("");
  const [thread, setThread] = useState<{ key: string; messages: PortalMessage[] }>({ key: "", messages: [] });
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const threadKey = `${clientId}:${engagementId}`;
  const messages = useMemo(() => thread.key === threadKey ? thread.messages : [], [thread, threadKey]);
  const selectedEngagement = engagements.find((item) => item.id === engagementId);
  const contextClosed = selectedEngagement?.status === "completed" || selectedEngagement?.status === "cancelled";

  const loadMessages = useCallback(async (background = false) => {
    const request = ++requestSequence.current;
    if (!background) setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ messages: PortalMessage[] }>(
        `/api/messages?clientId=${encodeURIComponent(clientId)}${engagementId ? `&engagementId=${encodeURIComponent(engagementId)}` : ""}`,
        { token }
      );
      if (request !== requestSequence.current) return;
      setThread((previous) => ({ key: threadKey, messages: uniqueMessages([...data.messages, ...(previous.key === threadKey ? previous.messages : [])]) }));
    } catch (cause) {
      if (request === requestSequence.current) setError(cause instanceof Error ? cause.message : "Failed to load messages");
    } finally {
      if (!background && request === requestSequence.current) setLoading(false);
    }
  }, [clientId, engagementId, threadKey, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);

  const liveConnected = useMessageRealtime({
    clientId,
    token,
    engagementId,
    includeAccountWide: false,
    onMessage: useCallback((message: PortalMessage) => {
      setThread((current) => ({ key: threadKey, messages: uniqueMessages([...(current.key === threadKey ? current.messages : []), message]) }));
    }, [threadKey]),
  });
  useMessagePolling(() => loadMessages(true), !liveConnected, threadKey);

  useEffect(() => {
    // Scroll the thread itself, not the page: scrollIntoView would also move the
    // record page under its sticky header.
    const thread = threadRef.current;
    if (messages.length && thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length]);

  async function send() {
    if (!body.trim() || sending || contextClosed) return;
    setSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message: PortalMessage }>("/api/messages", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId, body: body.trim(), engagementId: engagementId && engagementId !== "account" ? engagementId : null }),
      });
      if (messageMatchesContext(data.message, engagementId, false)) setThread((current) => ({ key: threadKey, messages: uniqueMessages([...(current.key === threadKey ? current.messages : []), data.message]) }));
      setBody("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const fullPageHref = `/messages?clientId=${encodeURIComponent(clientId)}${engagementId ? `&engagementId=${encodeURIComponent(engagementId)}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:max-w-xs">
          <Dropdown id="client-message-context" label="Work context" value={engagementId} disabled={sending} onChange={setEngagementId} options={[
            { value: "", label: "All work" }, { value: "account", label: "Account-wide" }, ...engagements.map((item) => ({ value: item.id, label: item.name })),
          ]} />
        </div>
        <Link href={fullPageHref} prefetch={false} className="text-[13px] font-semibold text-[var(--brand)] hover:underline">Open in Messages</Link>
      </div>
      {error ? <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
      <Card className="flex min-h-[28rem] flex-col overflow-hidden p-0">
        <div ref={threadRef} className="max-h-[32rem] min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite" aria-label={`Messages with ${clientName}`}>
          {loading && messages.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">Loading messages…</p>
          ) : messages.length === 0 ? (
            <EmptyState title="No messages yet" description={`Messages with ${clientName} in this context will appear here.`} />
          ) : (
            messages.map((message) => {
              const mine = message.authorId === session?.uid;
              return (
                <div key={message.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                  <div className={cn("max-w-[85%] rounded-[var(--radius-lg)] px-3.5 py-2.5 text-sm leading-6", mine ? "rounded-br-md bg-[var(--brand)] text-[var(--on-brand)]" : message.authorRole === "client" ? "rounded-bl-md bg-[var(--accent-soft)] text-[var(--ink)]" : "rounded-bl-md bg-[var(--surface-2)] text-[var(--ink)]")}>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                  <p className="text-[11px] text-[var(--ink-muted)]">{message.authorName} · {formatDateTime(message.createdAt)}</p>
                </div>
              );
            })
          )}
        </div>
        <form
          className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-5"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          <Label htmlFor="client-message-body">{contextClosed ? "This engagement is closed to new messages" : `Message ${clientName}`}</Label>
          <div className="flex items-end gap-2">
            <Textarea
              id="client-message-body"
              rows={2}
              value={body}
              disabled={sending || contextClosed}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              placeholder="Write a message the client will see in their portal…"
            />
            <Button type="submit" disabled={sending || contextClosed || !body.trim()} aria-label="Send message"><Send className="h-4 w-4" /><span className="hidden sm:inline">Send</span></Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
