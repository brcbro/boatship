"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, MessageSquareText, Send, UserRound } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { useMessagePolling } from "@/components/shared/useMessagePolling";
import { useMessageRealtime } from "@/components/shared/useMessageRealtime";
import {
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  PageHeader,
  ProgressBar,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDate, formatDateTime, statusLabel } from "@/lib/utils";
import type { ClientWithProgress, PortalMessage } from "@/types";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "on_hold") return "danger";
  if (status === "not_started") return "warning";
  return "neutral";
}

function messageDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function uniqueMessages(messages: PortalMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => !seen.has(message.id) && Boolean(seen.add(message.id)));
}

function AdminMessagesInner() {
  const { session, token } = useAuth();
  const searchParams = useSearchParams();
  const initialClientId = searchParams.get("clientId") || "";

  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [clientId, setClientId] = useState(initialClientId);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [body, setBody] = useState("");
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pickedDefault = useRef(false);
  const previousThreadRef = useRef("");
  const previousMessageCountRef = useRef(0);

  useEffect(() => {
    if (initialClientId) setClientId(initialClientId);
  }, [initialClientId]);

  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const data = await apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token });
      setClients(data.clients);
      if (!pickedDefault.current && !initialClientId && data.clients[0]) {
        pickedDefault.current = true;
        setClientId(data.clients[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoadingClients(false);
    }
  }, [token, initialClientId]);

  const loadMessages = useCallback(async (background = false) => {
    if (!clientId) {
      setMessages([]);
      return;
    }
    if (!background) setLoadingMessages(true);
    setError("");
    try {
      const data = await apiFetch<{ messages: PortalMessage[] }>(
        `/api/messages?clientId=${encodeURIComponent(clientId)}`,
        { token }
      );
      setMessages(uniqueMessages(data.messages));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      if (!background) setLoadingMessages(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const liveConnected = useMessageRealtime({
    clientId,
    token,
    onMessage: useCallback((message: PortalMessage) => {
      setMessages((current) => uniqueMessages([...current, message]));
    }, []),
  });
  useMessagePolling(() => loadMessages(true), Boolean(clientId) && !liveConnected);

  useEffect(() => {
    const isNewThread = previousThreadRef.current !== clientId;
    const hasNewMessage = messages.length > previousMessageCountRef.current;
    if (messages.length && (isNewThread || hasNewMessage)) {
      bottomRef.current?.scrollIntoView({ behavior: isNewThread ? "auto" : "smooth" });
    }
    previousThreadRef.current = clientId;
    previousMessageCountRef.current = messages.length;
  }, [clientId, messages.length]);

  const options = useMemo(
    () =>
      clients.map((c) => ({
        value: c.id,
        label: `${c.name} · ${c.companyName}`,
      })),
    [clients]
  );

  const selected = clients.find((c) => c.id === clientId);
  const conversationMeta = useMemo(() => {
    if (!messages.length) return null;
    const latest = messages[messages.length - 1];
    return { latest, clientMessages: messages.filter((message) => message.authorRole === "client").length };
  }, [messages]);

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
      setMessages((prev) => uniqueMessages([...prev, data.message]));
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Messages"
        description="Keep client conversations connected to the work that moves onboarding forward."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <Card className="mb-5 border-[var(--border)]/90 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Conversation</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Choose the client thread you want to work in.</p>
          </div>
          <div className="w-full sm:w-[min(100%,25rem)]">
            <span className="sr-only">Client</span>
            {loadingClients ? (
              <p className="py-2 text-sm text-[var(--ink-muted)]">Loading clients…</p>
            ) : options.length === 0 ? (
              <p className="py-2 text-sm text-[var(--ink-muted)]">No clients yet.</p>
            ) : (
              <Dropdown
                value={clientId}
                onChange={setClientId}
                options={options}
                placeholder="Select a client…"
              />
            )}
          </div>
        </div>
      </Card>

      {!clientId ? (
        <EmptyState
          title="Select a client"
          description="Choose a client above to view and send portal messages."
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Card className="flex min-h-[min(46rem,calc(100vh-15rem))] flex-col overflow-hidden p-0">
            <div className="flex flex-col gap-4 border-b border-[var(--border)] bg-[var(--surface)]/45 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-sm font-semibold text-white" aria-hidden="true">
                  {(selected?.name || "C").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-[var(--ink)]">{selected ? selected.companyName : "Conversation"}</h2>
                  <p className="truncate text-sm text-[var(--ink-muted)]">{selected?.name || "Client conversation"}</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-emerald-600/15 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 sm:self-auto">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                Live updates
              </span>
            </div>

            <div className="min-h-[21rem] flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6" aria-live="polite" aria-label="Conversation messages">
              {loadingMessages ? (
                <p className="py-12 text-center text-sm text-[var(--ink-muted)]">Loading conversation…</p>
              ) : messages.length === 0 ? (
                <div className="mx-auto flex max-w-sm flex-col items-center py-12 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--brand)]"><MessageSquareText className="h-5 w-5" aria-hidden="true" /></div>
                  <p className="font-medium text-[var(--ink)]">Start a useful conversation</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">Ask for the one detail or decision that will help this onboarding move ahead.</p>
                </div>
              ) : (
                messages.map((m, index) => {
                  const previous = messages[index - 1];
                  const mine = m.authorId === session?.uid;
                  const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                  const newAuthor = !previous || previous.authorId !== m.authorId || newDay;
                  return (
                    <div key={`${m.id}-${index}`}>
                      {newDay ? <div className="my-5 flex items-center gap-3 first:mt-0"><span className="h-px flex-1 bg-[var(--border)]" /><span className="shrink-0 text-[11px] font-medium text-[var(--ink-muted)]">{messageDay(m.createdAt)}</span><span className="h-px flex-1 bg-[var(--border)]" /></div> : null}
                      <div className={cn("flex gap-2.5", mine ? "justify-end" : "justify-start")}>
                        {!mine && newAuthor ? <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--ink-muted)]" aria-hidden="true">{m.authorName.slice(0, 1).toUpperCase()}</div> : !mine ? <div className="w-7 shrink-0" /> : null}
                        <div className={cn("max-w-[min(85%,38rem)]", mine ? "items-end" : "items-start")}>
                          {newAuthor ? <p className={cn("mb-1 px-1 text-xs font-medium text-[var(--ink-muted)]", mine && "text-right")}>{mine ? "You" : m.authorName}{!mine && m.authorRole === "client" ? " · Client" : ""}</p> : null}
                          <div className={cn("rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm", mine ? "rounded-tr-md bg-[var(--brand)] text-white" : "rounded-tl-md border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)]")}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          </div>
                          <p className={cn("mt-1 px-1 text-[11px] text-[var(--ink-muted)]", mine && "text-right")}>{formatDateTime(m.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--surface)]/35 p-4 sm:p-5">
              <label htmlFor="message-body" className="mb-2 block text-sm font-medium text-[var(--ink)]">Reply to {selected?.name || "client"}</label>
              <Textarea id="message-body" rows={3} placeholder="Write a clear, helpful message…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
              <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--ink-muted)]">Press <kbd className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 font-sans text-[10px]">Ctrl</kbd> <span aria-hidden="true">+</span> <kbd className="rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 font-sans text-[10px]">Enter</kbd> to send</p>
                <Button type="button" disabled={sending || !body.trim()} onClick={() => void send()}><Send className="h-4 w-4" aria-hidden="true" />{sending ? "Sending…" : "Send message"}</Button>
              </div>
            </div>
          </Card>

          <aside className="space-y-4 xl:sticky xl:top-6" aria-label="Client conversation context">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Onboarding context</p><h2 className="mt-1 font-semibold text-[var(--ink)]">{selected?.companyName}</h2></div><Badge tone={statusTone(selected?.status || "")}>{statusLabel(selected?.status || "not_started")}</Badge></div>
              <div className="mt-5"><div className="mb-2 flex items-center justify-between text-sm"><span className="text-[var(--ink-muted)]">Completion</span><span className="font-semibold tabular-nums text-[var(--ink)]">{selected?.progress || 0}%</span></div><ProgressBar value={selected?.progress || 0} /><p className="mt-2 text-xs text-[var(--ink-muted)]">{selected?.completedTasks || 0} of {selected?.totalTasks || 0} tasks complete</p></div>
              <dl className="mt-5 space-y-3 border-t border-[var(--border)] pt-4 text-sm"><div className="flex items-start justify-between gap-3"><dt className="text-[var(--ink-muted)]">Stage</dt><dd className="text-right font-medium text-[var(--ink)]">{statusLabel(selected?.pipelineStage || "intake")}</dd></div><div className="flex items-start justify-between gap-3"><dt className="text-[var(--ink-muted)]">Owner</dt><dd className="text-right font-medium text-[var(--ink)]">{selected?.assignedTeamMemberName || "Unassigned"}</dd></div></dl>
            </Card>
            <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Conversation pulse</p><div className="mt-4 space-y-4"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--brand)]"><UserRound className="h-4 w-4" aria-hidden="true" /></div><div><p className="text-sm font-medium text-[var(--ink)]">{conversationMeta?.clientMessages || 0} client message{conversationMeta?.clientMessages === 1 ? "" : "s"}</p><p className="text-xs text-[var(--ink-muted)]">in this conversation</p></div></div><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--brand)]"><CheckCheck className="h-4 w-4" aria-hidden="true" /></div><div><p className="text-sm font-medium text-[var(--ink)]">{conversationMeta ? "Thread active" : "No thread yet"}</p><p className="text-xs text-[var(--ink-muted)]">{conversationMeta ? `Last activity ${formatDate(conversationMeta.latest.createdAt)}` : "Send the opening note"}</p></div></div></div></Card>
            {selected?.tags?.length ? <Card className="p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Client labels</p><div className="mt-3 flex flex-wrap gap-1.5">{selected.tags.map((tag) => <span key={tag} className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)]">{tag}</span>)}</div></Card> : null}
          </aside>
        </div>
      )}
    </div>
  );
}

export default function AdminMessagesPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[var(--ink-muted)]">Loading messages…</p>}
    >
      <AdminMessagesInner />
    </Suspense>
  );
}
