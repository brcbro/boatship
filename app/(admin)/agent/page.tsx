"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ArrowUp,
  CircleStop,
  HardDrive,
  LoaderCircle,
  Plus,
  PlugZap,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, PageHeader, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { HodiActionCards } from "@/components/hodi/chat/HodiActionCards";

type AgentStatus = {
  composioConfigured: boolean;
  llmConfigured: boolean;
  driveConnected: boolean;
  ready: boolean;
  message: string | null;
  connectors: Array<{
    slug: string;
    name: string;
    connected: boolean;
  }>;
};

const SUGGESTIONS = [
  "Which clients are blocked and what should happen next?",
  "Give me the onboarding health for every active client",
  "Draft a follow-up for missing website assets",
  "Create an organized project folder for my newest client",
];

type AgentMessagePart = {
  type: string;
  text?: string;
  state?: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  input?: unknown;
  errorText?: string;
};

type StoredAgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
};

function messageText(parts: AgentMessagePart[]) {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

function normalizeAgentMarkdown(text: string) {
  return text.replace(
    /\[([^\]]+)\]\s*\n\s*\((https?:\/\/[^\s)]+)\)/g,
    "[$1]($2)"
  );
}

function AgentMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="break-words whitespace-pre-wrap">{children}</p>,
        a: ({ children, href }) => {
          const label = typeof children === "string" && /^https?:\/\//.test(children)
            ? "Open link"
            : children;
          return href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--brand)] underline decoration-[var(--brand)]/40 underline-offset-2 hover:decoration-[var(--brand)]"
            >
              {label}
            </a>
          ) : <>{label}</>;
        },
        table: ({ children }) => (
          <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="min-w-full border-collapse text-left text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="whitespace-nowrap border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-semibold">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-[var(--border)] px-3 py-2 align-top last:border-b-0">{children}</td>,
        code: ({ children }) => <code className="break-words rounded bg-[var(--surface-2)] px-1 py-0.5 text-xs">{children}</code>,
        pre: ({ children }) => <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-xs">{children}</pre>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
      }}
    >
      {normalizeAgentMarkdown(text)}
    </ReactMarkdown>
  );
}

function humanizeToolName(part: AgentMessagePart) {
  const name = part.title || part.toolName || part.type.replace(/^tool-/, "");
  return name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toolStateLabel(state?: string) {
  if (state === "output-available") return "Completed";
  if (state === "output-error") return "Failed";
  if (state === "output-denied") return "Not approved";
  if (state === "approval-requested") return "Waiting for approval";
  if (state === "input-streaming") return "Preparing";
  return "Calling";
}

export default function AgentPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent/chat",
        headers: () => ({
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }),
        body: () => (activeSessionId ? { sessionId: activeSessionId } : {}),
      }),
    [token, activeSessionId]
  );

  const { messages, sendMessage, status: chatStatus, error, setMessages, stop } = useChat({
    transport,
  });

  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const connectedConnectorCount = status?.connectors.filter((connector) => connector.connected).length ?? 0;

  useEffect(() => {
    if (!token) return;
    void apiFetch<{ sessions: ChatSession[] }>("/api/agent/history", { token })
      .then(async ({ sessions: existing }) => {
        const initial = existing[0] || (await apiFetch<{ session: ChatSession }>("/api/agent/history", {
          method: "POST",
          token,
          body: JSON.stringify({}),
        })).session;
        setSessions(existing.length ? existing : [initial]);
        setActiveSessionId(initial.id);
      })
      .catch(() => {
        // A transient session read should not prevent a later retry.
      });
  }, [token, setMessages]);

  useEffect(() => {
    if (!token || !activeSessionId) return;
    setMessages([]);
    void apiFetch<{ messages: StoredAgentMessage[] }>(
      `/api/agent/history?sessionId=${encodeURIComponent(activeSessionId)}`,
      { token }
    )
      .then(({ messages: history }) => {
        const orderedMessages = [...history].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt)
        );
        setMessages(orderedMessages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: [{ type: "text" as const, text: message.text }],
        })));
      })
      .catch(() => {});
  }, [token, activeSessionId, setMessages]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: busy ? "auto" : "smooth",
    });
  }, [messages, busy]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await apiFetch<AgentStatus>("/api/agent", { token });
      setStatus(res);
    } catch {
      setStatus({
        composioConfigured: false,
        llmConfigured: false,
        driveConnected: false,
        ready: false,
        message: "Could not load agent status.",
        connectors: [],
      });
    } finally {
      setStatusLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !status?.ready || !activeSessionId) return;
    setInput("");
    if (composerRef.current) {
      composerRef.current.style.height = "44px";
      composerRef.current.style.overflowY = "hidden";
    }
    await sendMessage({ text });
  }

  function runSuggestion(text: string) {
    if (busy || !status?.ready || !activeSessionId) return;
    void sendMessage({ text });
  }

  function resizeComposer(textarea: HTMLTextAreaElement) {
    const maxHeight = 84;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  async function newChat() {
    if (!token || busy) return;
    try {
      const { session } = await apiFetch<{ session: ChatSession }>("/api/agent/history", {
        method: "POST", token, body: JSON.stringify({}),
      });
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
    } catch {}
  }

  async function deleteActiveChat() {
    if (!token || !activeSessionId || busy) return;
    try {
      await apiFetch(`/api/agent/history?sessionId=${encodeURIComponent(activeSessionId)}`, {
        method: "DELETE", token,
      });
      const remaining = sessions.filter((session) => session.id !== activeSessionId);
      setSessions(remaining);
      if (remaining[0]) setActiveSessionId(remaining[0].id);
      else await newChat();
    } catch {}
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-5xl min-h-[30rem] flex-col gap-4 overflow-hidden lg:h-[calc(100dvh-4rem)]">
      <PageHeader
        title="Hodi"
        description="Your onboarding coordinator for blockers, next steps, project assets, and connected apps."
        actions={
          <>
            <details className="group relative">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]">
                <PlugZap className="h-4 w-4" />
                Connected apps
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-[var(--ink-muted)]">
                  {connectedConnectorCount} connected
                </span>
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-[0_16px_40px_rgba(20,20,20,0.14)]">
                <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">Connections</p>
                {status?.connectors.length ? status.connectors.map((connector) => (
                  <div key={connector.slug} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2 truncate text-[var(--ink)]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${connector.connected ? "bg-[var(--success)]" : "bg-[var(--border)]"}`} />
                      <span className="truncate">{connector.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--ink-muted)]">{connector.connected ? "Connected" : "Not connected"}</span>
                  </div>
                )) : (
                  <p className="px-2 py-3 text-sm text-[var(--ink-muted)]">Checking connectors…</p>
                )}
                <Link href="/integrations" className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]">
                  <HardDrive className="h-4 w-4" /> Manage integrations
                </Link>
              </div>
            </details>
            <Link
              href="/integrations"
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
            >
              <HardDrive className="h-4 w-4" />
              Integrations
            </Link>
          </>
        }
      />

      {statusLoading ? (
        <p className="text-sm text-[var(--ink-muted)]">Checking Hodi…</p>
      ) : status && !status.ready ? (
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
              Setup required
            </h2>
          </div>
          <p className="text-sm text-[var(--ink-muted)]">{status.message}</p>
          <ul className="space-y-2 text-sm text-[var(--ink)]">
            <li className="flex items-center gap-2">
              <Badge tone={status.composioConfigured ? "success" : "warning"}>
                {status.composioConfigured ? "OK" : "Needed"}
              </Badge>
              COMPOSIO_API_KEY
            </li>
            <li className="flex items-center gap-2">
              <Badge tone={status.llmConfigured ? "success" : "warning"}>
                {status.llmConfigured ? "OK" : "Needed"}
              </Badge>
              OPENROUTER_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY
            </li>
            <li className="flex items-center gap-2">
              <Badge tone={status.driveConnected ? "success" : "warning"}>
                {status.driveConnected ? "Connected" : "Connect"}
              </Badge>
              Your Google Drive on{" "}
              <Link href="/integrations" className="underline">
                Integrations
              </Link>
            </li>
          </ul>
          <Button variant="secondary" size="sm" onClick={() => void loadStatus()}>
            Refresh status
          </Button>
        </Card>
      ) : null}

      <Card className="flex min-h-0 flex-1 overflow-hidden p-0 shadow-[0_12px_40px_rgba(20,20,20,0.08)]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-raised)] md:flex">
          <div className="p-3">
            <Button type="button" className="w-full" onClick={() => void newChat()} disabled={busy || !token}>
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            <p className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">Chats</p>
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  disabled={busy}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${session.id === activeSessionId ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}
                >
                  <span className="block truncate">{session.title}</span>
                  <span className="mt-0.5 block text-xs font-normal text-[var(--ink-muted)]">
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-raised)] p-2 md:hidden">
            <Button type="button" size="sm" onClick={() => void newChat()} disabled={busy || !token}>
              <Plus className="h-4 w-4" /> New
            </Button>
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                disabled={busy}
                className={`max-w-44 shrink-0 truncate rounded-md px-3 py-2 text-sm transition ${session.id === activeSessionId ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface)]"}`}
              >
                {session.title}
              </button>
            ))}
          </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-base text-[var(--ink)]">Hodi</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">
                {busy ? "Working on your request…" : status?.ready ? "Onboarding health + connected apps" : "Setup required"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden items-center gap-1.5 text-xs text-[var(--ink-muted)] sm:flex">
              <span className={`h-2 w-2 rounded-full ${status?.ready ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`} />
              {status?.ready ? "Ready" : "Offline"}
            </span>
            {activeSessionId ? (
              <button
                type="button"
                aria-label="Delete chat"
                title="Delete chat"
                onClick={() => void deleteActiveChat()}
                disabled={busy}
                className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--surface)] px-4 py-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center space-y-5 py-6">
              <div className="space-y-1 text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-sm">
                  <Bot className="h-6 w-6" />
                </span>
                <p className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">What can I help you find?</p>
                <p className="text-sm text-[var(--ink-muted)]">Find blockers, prepare follow-ups, organize client assets, and keep every onboarding moving.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!status?.ready || busy}
                    onClick={() => runSuggestion(s)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-sm text-[var(--ink)] transition hover:border-[var(--brand)]/40 hover:bg-[var(--surface-2)] disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) => {
              const parts = m.parts as AgentMessagePart[];
              const text = messageText(parts);
              const reasoningParts = parts.filter((p) => p.type === "reasoning" && p.text);
              const toolParts = parts.filter(
                (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
              );
              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "max-w-[88%] self-end rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-3 text-sm leading-relaxed text-white sm:max-w-[78%]"
                      : "max-w-[92%] self-start space-y-2 rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)] sm:max-w-[82%]"
                  }
                >
                  {text ? (
                    m.role === "assistant" ? <AgentMarkdown text={text} /> : <p className="break-words whitespace-pre-wrap">{text}</p>
                  ) : null}
                  {m.role === "assistant" && text ? (
                    <HodiActionCards text={text} token={token} connectors={status?.connectors ?? []} onRun={runSuggestion} />
                  ) : null}
                  {reasoningParts.length > 0 || toolParts.length > 0 ? (
                    <details className="group rounded-md border border-[var(--border)] bg-[var(--surface-raised)]/70 text-[var(--ink)]">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium marker:hidden">
                        <Wrench className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                        Activity
                        <span className="text-[var(--ink-muted)]">
                          {reasoningParts.length > 0 ? "Thinking" : ""}
                          {reasoningParts.length > 0 && toolParts.length > 0 ? " · " : ""}
                          {toolParts.length > 0
                            ? `${toolParts.length} action${toolParts.length === 1 ? "" : "s"}`
                            : ""}
                        </span>
                        <span className="ml-auto text-[var(--ink-muted)] transition group-open:rotate-180">⌄</span>
                      </summary>
                      <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
                        {reasoningParts.map((part, index) => (
                          <div key={`reasoning-${part.type}-${index}`}>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                              Thinking{part.state === "streaming" ? "…" : ""}
                            </p>
                            <p className="whitespace-pre-wrap text-xs leading-relaxed">{part.text}</p>
                          </div>
                        ))}
                        {toolParts.map((part, index) => (
                          <div key={part.toolCallId || `${part.type}-${index}`} className="rounded border border-[var(--border)] bg-[var(--surface)]/70 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium">{humanizeToolName(part)}</p>
                              <span className="text-[11px] text-[var(--ink-muted)]">
                                {toolStateLabel(part.state)}
                              </span>
                            </div>
                            {part.input !== undefined ? (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]">
                                  View request details
                                </summary>
                                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-raised)] p-2 text-[10px] leading-relaxed text-[var(--ink-muted)]">
                                  {JSON.stringify(part.input, null, 2)}
                                </pre>
                              </details>
                            ) : null}
                            {part.errorText ? (
                              <p className="mt-2 text-xs text-[var(--danger)]">{part.errorText}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
            </div>
          )}
          {busy ? (
            <p className="mx-auto mt-4 flex max-w-3xl items-center gap-2 text-sm text-[var(--ink-muted)]">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Hodi is working…
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
              {error.message}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-raised)] p-3 sm:p-4"
        >
          <div className="relative">
            <Textarea
              ref={composerRef}
              rows={1}
              placeholder={
                status?.ready
                  ? "Ask about onboarding health, blockers, folders, or a follow-up draft…"
                  : "Finish setup above to chat"
              }
              value={input}
              disabled={!status?.ready || busy}
              onChange={(e) => {
                setInput(e.target.value);
                resizeComposer(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit(e);
                }
              }}
              className="h-11 min-h-11 max-h-[84px] resize-none overflow-y-auto rounded-xl pr-14"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop generating"
                title="Stop generating"
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ink)] text-white transition hover:bg-[var(--brand-strong)]"
              >
                <CircleStop className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!status?.ready || !input.trim()}
                aria-label="Send message"
                title="Send message"
                className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand)] text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-muted)]"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>
        </div>
      </Card>
    </div>
  );
}
