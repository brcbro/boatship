"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, MessageCircle, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useMessagePolling } from "@/components/shared/useMessagePolling";
import { useMessageRealtime } from "@/components/shared/useMessageRealtime";
import {
  Button,
  Card,
  EmptyState,
  Dropdown,
  Label,
  PageHeader,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { messageMatchesContext } from "@/lib/message-context";
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
  return <Suspense fallback={<p className="text-sm text-[var(--ink-muted)]">Loading your conversation…</p>}><PortalMessagesInner /></Suspense>;
}

type EngagementOption = { id: string; name: string; status: string };

function PortalMessagesInner() {
  const { session, token, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const initialEngagementId = searchParams.get("engagementId") || "";
  const initialIncludeAccountWide = searchParams.get("includeAccountWide") === "1" || searchParams.get("includeAccountWide") === "true";
  const [engagementId, setEngagementId] = useState(initialEngagementId);
  const [includeAccountWide, setIncludeAccountWide] = useState(initialIncludeAccountWide);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [thread, setThread] = useState<{ key: string; messages: PortalMessage[] }>({ key: "", messages: [] });
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const clientId = session?.clientId;
  const threadKey = `${clientId || ""}:${engagementId}:${includeAccountWide}`;
  const messages = useMemo(() => thread.key === threadKey ? thread.messages : [], [thread, threadKey]);
  const requestSequence = useRef(0);
  const selectedEngagement = engagements.find((item) => item.id === engagementId);
  const contextName = selectedEngagement?.name || (engagementId && engagementId !== "account" ? "Selected engagement" : "Account-wide");
  const contextClosed = selectedEngagement?.status === "completed" || selectedEngagement?.status === "cancelled";
  const contextUnavailable = Boolean(engagementId && engagementId !== "account" && !selectedEngagement);
  const groupedMessages = useMemo(
    () => groupMessagesByDate(messages),
    [messages],
  );

  const load = useCallback(
    async (background = false) => {
      const request = ++requestSequence.current;
      if (!clientId) {
        setError("No client account is linked to this user.");
        if (!background) setLoading(false);
        return;
      }
      if (!background) setLoading(true);
      setError("");
      try {
        const data = await apiFetch<{ messages: PortalMessage[] }>(
          `/api/messages?clientId=${encodeURIComponent(clientId)}${engagementId ? `&engagementId=${encodeURIComponent(engagementId)}` : ""}${includeAccountWide ? "&includeAccountWide=1" : ""}`,
          { token },
        );
        if (request !== requestSequence.current) return;
        setThread((previous) => ({ key: threadKey, messages: uniqueMessages([...data.messages, ...(previous.key === threadKey ? previous.messages : [])]) }));
      } catch (err) {
        if (request === requestSequence.current) setError(
          err instanceof Error ? err.message : "Failed to load messages",
        );
      } finally {
        if (!background && request === requestSequence.current) setLoading(false);
      }
    },
    [clientId, token, engagementId, includeAccountWide, threadKey],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => { setEngagementId(initialEngagementId); setIncludeAccountWide(initialIncludeAccountWide); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialEngagementId, initialIncludeAccountWide]);

  useEffect(() => {
    if (!clientId || authLoading) return;
    let cancelled = false;
    void apiFetch<{ engagements: EngagementOption[] }>(`/api/clients/${encodeURIComponent(clientId)}/engagements`, { token }).then((data) => {
      if (!cancelled) setEngagements(data.engagements);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn’t load work contexts."); });
    return () => { cancelled = true; };
  }, [clientId, token, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [authLoading, load]);
  const liveConnected = useMessageRealtime({
    clientId,
    token,
    engagementId,
    includeAccountWide,
    onMessage: useCallback((message: PortalMessage) => {
      setThread((current) => ({ key: threadKey, messages: uniqueMessages([...(current.key === threadKey ? current.messages : []), message]) }));
    }, [threadKey]),
  });
  useMessagePolling(() => load(true), Boolean(clientId) && !authLoading && !liveConnected, threadKey);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send() {
    if (!clientId || !body.trim() || sending || contextClosed || contextUnavailable) return;
    setSending(true);
    setError("");
    try {
      const data = await apiFetch<{ message: PortalMessage }>("/api/messages", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId, body: body.trim(), engagementId: engagementId && engagementId !== "account" ? engagementId : null }),
      });
      if (messageMatchesContext(data.message, engagementId, includeAccountWide)) setThread((current) => ({ key: threadKey, messages: uniqueMessages([...(current.key === threadKey ? current.messages : []), data.message]) }));
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
        description="A direct line to your Boatship team. Ask questions, share context, and keep the work moving."
      />
      {clientId ? <div className="mb-5 max-w-md"><Label htmlFor="portal-message-context">Work context</Label><Dropdown id="portal-message-context" value={engagementId} disabled={sending} onChange={setEngagementId} options={[
        { value: "", label: "All work" }, { value: "account", label: "Account-wide" }, ...engagements.map((item) => ({ value: item.id, label: item.name })),
      ]} />{engagementId && engagementId !== "account" ? <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-[var(--ink-muted)]"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={includeAccountWide} disabled={sending} onChange={(event) => setIncludeAccountWide(event.target.checked)} />Also show account-wide messages</label> : null}</div> : null}
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-lg)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] px-5 py-12 text-center text-sm text-[var(--ink-muted)]">
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
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--brand)] text-[var(--on-brand)] shadow-[0_8px_18px_rgba(20,43,53,0.14)]"
                aria-hidden="true"
              >
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-[family-name:var(--font-display)] text-xl leading-tight text-[var(--ink)]">
                  Your Boatship team
                </h2>
                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                  We’ll reply here as your work progresses.
                </p>
              </div>
            </div>
            <span
              role="status"
              className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--success)]/30 bg-[var(--success-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]"
            >
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--success)]" />
              </span>
              {liveConnected ? "Live updates on" : "Checking for updates"}
            </span>
          </header>
          <section
            className="max-h-[min(36rem,58dvh)] min-h-[22rem] overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
            aria-live="polite"
            aria-label="Conversation with your Boatship team"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--brand-soft)] text-[var(--brand)]"
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
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]"
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
                                  "rounded-[var(--radius-lg)] px-3.5 py-2.5 text-sm leading-6 shadow-sm",
                                  mine
                                    ? "rounded-br-md bg-[var(--brand)] text-[var(--on-brand)]"
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
                                <span>{message.engagementId ? engagements.find((item) => item.id === message.engagementId)?.name || "Engagement" : "Account-wide"} · </span>
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
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{contextUnavailable ? "Choose an available work context before sending." : contextClosed ? `${contextName} is closed. Choose an active engagement or Account-wide to send a message.` : `Sending to ${contextName}.`}</p>
            <Textarea
              id="portal-message"
              rows={3}
              className="mt-2 min-h-24 resize-y"
              placeholder="Share a question, update, or anything your team should know…"
              value={body}
              disabled={sending || contextClosed || contextUnavailable}
              maxLength={10000}
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
                disabled={sending || !body.trim() || contextClosed || contextUnavailable}
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
