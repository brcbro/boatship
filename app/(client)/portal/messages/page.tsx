"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, EmptyState, PageHeader, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import type { PortalMessage } from "@/types";

export default function PortalMessagesPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const clientId = session?.clientId;

  const load = useCallback(async () => {
    if (!clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ messages: PortalMessage[] }>(
        `/api/messages?clientId=${encodeURIComponent(clientId)}`,
        { token }
      );
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    if (!clientId || !body.trim()) return;
    setSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message: PortalMessage }>("/api/messages", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId, body: body.trim() }),
      });
      setMessages((prev) => [...prev, data.message]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Chat with your Boatship onboarding team."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading messages…</p>
      ) : !clientId ? (
        <EmptyState
          title="No client linked"
          description="Your account is not connected to a client workspace."
        />
      ) : (
        <Card className="flex flex-col gap-4 p-0 overflow-hidden">
          <div className="max-h-[min(28rem,55vh)] min-h-[16rem] space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ink-muted)]">
                No messages yet. Say hello to start the conversation.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.authorId === session?.uid;
                return (
                  <div
                    key={m.id}
                    className={cn("flex flex-col", mine ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                        mine
                          ? "bg-[var(--brand)] text-white"
                          : "bg-[var(--surface-2)] text-[var(--ink)]"
                      )}
                    >
                      {!mine ? (
                        <p className="mb-0.5 text-[11px] font-medium opacity-80">{m.authorName}</p>
                      ) : null}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                      {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-[var(--border)] px-5 py-4">
            <Textarea
              rows={3}
              placeholder="Write a message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                disabled={sending || !body.trim()}
                onClick={() => void send()}
              >
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
