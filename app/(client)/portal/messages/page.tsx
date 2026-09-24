"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, MessageCircle, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useMessagePolling } from "@/components/shared/useMessagePolling";
import { useMessageRealtime } from "@/components/shared/useMessageRealtime";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { PortalMessage } from "@/types";

type MessageGroup = { label: string; messages: PortalMessage[] };

function uniqueMessages(messages: PortalMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => !seen.has(message.id) && Boolean(seen.add(message.id)));
}

function groupMessagesByDate(messages: PortalMessage[]): MessageGroup[] {
  const groups = new Map<string, PortalMessage[]>();
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const key = Number.isNaN(date.getTime())
      ? message.createdAt
      : date.toDateString();
    const group = groups.get(key) ?? [];
    group.push(message);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, group]) => ({
    label: formatDate(group[0]?.createdAt) || key,
    messages: group,
  }));
}

export default function PortalMessagesPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const clientId = session?.clientId;
  const groupedMessages = useMemo(
    () => groupMessagesByDate(messages),
    [messages],
  );

  const load = useCallback(
    async (background = false) => {
      if (!clientId) {
        setError("No client account is linked to this user.");
        if (!background) setLoading(false);
        return;
      }
      if (!background) setLoading(true);
      setError("");
      try {
        const data = await apiFetch<{ messages: PortalMessage[] }>(
          `/api/messages?clientId=${encodeURIComponent(clientId)}`,
          { token },
        );
        setMessages(uniqueMessages(data.messages));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load messages",
        );
      } finally {
        if (!background) setLoading(false);
      }
    },
    [clientId, token],
  );

  useEffect(() => {
    if (authLoading) return;
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [authLoading, load]);
  const liveConnected = useMessageRealtime({
    clientId,
    token,
    onMessage: useCallback((message: PortalMessage) => {
      setMessages((current) => uniqueMessages([...current, message]));
    }, []),
  });
  useMessagePolling(() => load(true), Boolean(clientId) && !authLoading && !liveConnected);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send() {
    if (!clientId || !body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message: PortalMessage }>("/api/messages", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId, body: body.trim() }),
      });
      setMessages((prev) => uniqueMessages([...prev, data.message]));
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Messages"
        description="A direct line to your Boatship onboarding team. Ask questions, share context, and keep the work moving."
      />
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-12 text-center text-sm text-[var(--ink-muted)]">
          Loading your conversation…
        </div>
      ) : !clientId ? (
        <EmptyState
          title="No client linked"
          description="Your account is not connected to a client workspace."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <header className="flex flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)]/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-[0_8px_18px_rgba(20,43,53,0.14)]"
                aria-hidden="true"
              >
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-[family-name:var(--font-display)] text-xl leading-tight text-[var(--ink)]">
                  Your onboarding team
                </h2>
                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                  We’ll reply here as your onboarding progresses.
                </p>
              </div>
            </div>
            <span
              role="status"
              className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-700/15 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800"
            >
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Live updates on
            </span>
          </header>
          <section
            className="max-h-[min(36rem,58dvh)] min-h-[22rem] overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
            aria-live="polite"
            aria-label="Conversation with your onboarding team"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--brand)]"
                  aria-hidden="true"
                >
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                  Start the conversation
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
                  Send your team a note whenever you have a question, update, or
                  file to share.
                </p>
              </div>
            ) : (
              <div className="space-y-7">
                {groupedMessages.map((group) => (
                  <section
                    key={group.label}
                    aria-label={`Messages from ${group.label}`}
                  >
                    <div
                      className="mb-4 flex items-center gap-3"
                      aria-hidden="true"
                    >
                      <div className="h-px flex-1 bg-[var(--border)]" />
                      <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-muted)]">
                        {group.label}
                      </span>
                      <div className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                    <div className="space-y-4">
                      {group.messages.map((message) => {
                        const mine = message.authorId === session?.uid;
                        return (
                          <article
                            key={message.id}
                            className={cn(
                              "flex gap-2.5",
                              mine ? "justify-end" : "justify-start",
                            )}
                          >
                            {!mine ? (
                              <div
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--brand)]"
                                aria-hidden="true"
                              >
                                {message.authorName.charAt(0).toUpperCase()}
                              </div>
                            ) : null}
                            <div className="min-w-0 max-w-[min(85%,34rem)]">
                              {!mine ? (
                                <p className="mb-1 px-1 text-xs font-semibold text-[var(--ink-muted)]">
                                  {message.authorName}
                                </p>
                              ) : null}
                              <div
                                className={cn(
                                  "rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm",
                                  mine
                                    ? "rounded-br-md bg-[var(--brand)] text-white"
                                    : "rounded-bl-md border border-[var(--border)]/80 bg-[var(--surface-raised)] text-[var(--ink)]",
                                )}
                              >
                                <p className="[overflow-wrap:anywhere] whitespace-pre-wrap">
                                  {message.body}
                                </p>
                              </div>
                              <p
                                className={cn(
                                  "mt-1 flex items-center gap-1 px-1 text-[11px] text-[var(--ink-muted)]",
                                  mine && "justify-end",
                                )}
                              >
                                {formatDateTime(message.createdAt)}
                                {mine ? (
                                  <CheckCheck
                                    className="h-3.5 w-3.5"
                                    aria-label="Sent"
                                  />
                                ) : null}
                              </p>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </section>
          <form
            className="border-t border-[var(--border)] bg-[var(--surface)]/35 px-4 py-4 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label
              htmlFor="portal-message"
              className="text-sm font-semibold text-[var(--ink)]"
            >
              Write a message
            </label>
            <Textarea
              id="portal-message"
              rows={3}
              className="mt-2 min-h-24 resize-y"
              placeholder="Share a question, update, or anything your team should know…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
              aria-describedby="portal-message-hint"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                id="portal-message-hint"
                className="text-xs leading-5 text-[var(--ink-muted)]"
              >
                Press{" "}
                <kbd className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--ink)]">
                  Ctrl
                </kbd>{" "}
                +{" "}
                <kbd className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--ink)]">
                  Enter
                </kbd>{" "}
                to send
              </p>
              <Button
                type="submit"
                disabled={sending || !body.trim()}
                className="w-full sm:w-auto"
              >
                {sending ? (
                  "Sending…"
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" /> Send message
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
