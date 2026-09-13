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
  Check,
  CircleStop,
  Copy,
  HardDrive,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  PlugZap,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { HodiActionCards, type HodiActionArtifact } from "@/components/hodi/chat/HodiActionCards";

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

function evidenceLinks(text: string) {
  const urls = text.match(/https?:\/\/[^\s)<]+/g) ?? [];
  return [...new Set(urls)].slice(0, 3);
}

function safeToolError(state?: string) {
  if (state === "output-denied") return "This action was not approved.";
  if (state === "output-error") return "Hodi could not complete this action. Try again or adjust the request.";
  return null;
}

export default function AgentPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "helpful" | "not_helpful">>({});
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
  const connectedConnectors = status?.connectors.filter((connector) => connector.connected) ?? [];
  const connectedConnectorCount = connectedConnectors.length;

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

  async function copyMessage(messageId: string, text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => current === messageId ? null : current), 1600);
    } catch {
      // Clipboard access may be unavailable in an embedded or non-secure context.
    }
  }

  function editAndResend(text: string) {
    setInput(text);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      if (composerRef.current) resizeComposer(composerRef.current);
    });
  }

  function improveResponse() {
    if (busy || !status?.ready || !activeSessionId) return;
    void sendMessage({ text: "Improve your previous response. Keep it concise, cite the workspace evidence you used, and state any assumptions or next action clearly." });
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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <Card className="flex min-h-0 flex-1 overflow-hidden p-0 shadow-[0_18px_50px_rgba(20,20,20,0.08)]">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-raised)_80%,var(--surface))] md:flex">
          <div className="p-3">
            <Button type="button" className="w-full" onClick={() => void newChat()} disabled={busy || !token}>
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            <p className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Recent</p>
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  disabled={busy}
                  aria-current={session.id === activeSessionId ? "page" : undefined}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition duration-200 ${session.id === activeSessionId ? "bg-[var(--surface-2)] font-medium text-[var(--ink)] shadow-[inset_2px_0_0_var(--brand)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}
                >
                  <span className="block truncate">{session.title}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]">
          <header className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)]/80 bg-[var(--surface-raised)]/85 px-4 py-3 backdrop-blur sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(20,20,20,0.14)]" aria-hidden="true">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-display)] text-base text-[var(--ink)]">Hodi</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-[var(--ink-muted)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${status?.ready ? "bg-[var(--success)]" : "bg-[var(--warning)]"}`} aria-hidden="true" />
                  {busy ? "Working" : status?.ready ? "Ready" : "Setup required"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <details className="group relative">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
                  <PlugZap className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{connectedConnectorCount} apps</span>
                  <span className="sr-only">Connected apps</span>
                </summary>
                <div className="absolute right-0 z-40 mt-2 max-h-[min(26rem,calc(100dvh-7rem))] w-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2 shadow-[0_16px_40px_rgba(20,20,20,0.14)]">
                  {connectedConnectors.length ? connectedConnectors.map((connector) => (
                    <div key={connector.slug} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2 truncate text-[var(--ink)]"><span className={`h-2 w-2 shrink-0 rounded-full ${connector.connected ? "bg-[var(--success)]" : "bg-[var(--border)]"}`} /><span className="truncate">{connector.name}</span></span>
                      <span className="shrink-0 text-xs text-[var(--ink-muted)]">On</span>
                    </div>
                  )) : <p className="px-2 py-3 text-sm text-[var(--ink-muted)]">No connected apps</p>}
                  <Link href="/integrations" className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-2)]"><HardDrive className="h-4 w-4" /> Manage apps</Link>
                </div>
              </details>
              {activeSessionId ? <button type="button" aria-label="Delete chat" title="Delete chat" onClick={() => void deleteActiveChat()} disabled={busy} className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-50"><Trash2 className="h-4 w-4" /></button> : null}
            </div>
          </header>

          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-raised)] p-2 md:hidden">
            <details>
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-sm font-medium text-[var(--ink)]"><MessageSquare className="h-4 w-4" /> Chats</summary>
              <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-[var(--surface-2)] p-1.5">
                <Button type="button" size="sm" className="mb-1 w-full" onClick={() => void newChat()} disabled={busy || !token}><Plus className="h-4 w-4" /> New chat</Button>
                {sessions.map((session) => <button key={session.id} type="button" onClick={() => setActiveSessionId(session.id)} disabled={busy} className={`w-full rounded-md px-3 py-2 text-left text-sm ${session.id === activeSessionId ? "bg-[var(--surface-raised)] font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"}`}>{session.title}</button>)}
              </div>
            </details>
          </div>

          {statusLoading ? <div className="flex flex-1 items-center justify-center text-sm text-[var(--ink-muted)]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Preparing Hodi</div> : status && !status.ready ? (
            <div className="flex flex-1 items-center justify-center p-5"><Card className="w-full max-w-md space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">Finish setup</h2>
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
        </Card></div>
          ) : <>
        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 [scroll-padding-bottom:8rem] sm:px-8">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-xl flex-col justify-center space-y-6 py-8">
              <div className="space-y-2 text-center agent-message-enter">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_10px_24px_rgba(20,20,20,0.14)]">
                  <Bot className="h-6 w-6" />
                </span>
                <p className="font-[family-name:var(--font-display)] text-2xl tracking-[-0.02em] text-[var(--ink)]">What can I help with?</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!status?.ready || busy}
                    onClick={() => runSuggestion(s)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-3 text-left text-sm leading-snug text-[var(--ink)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--brand)]/40 hover:shadow-[0_8px_18px_rgba(20,20,20,0.06)] disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {messages.map((m) => {
              const parts = m.parts as AgentMessagePart[];
              const text = messageText(parts);
              const reasoningParts = parts.filter((p) => p.type === "reasoning" && p.text);
              const toolParts = parts.filter(
                (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
              );
              const actionArtifacts: HodiActionArtifact[] = toolParts.map((part, index) => ({
                id: part.toolCallId || `${part.type}-${index}`,
                name: humanizeToolName(part),
                state: part.state,
                error: Boolean(part.errorText),
              }));
              const sources = m.role === "assistant" ? evidenceLinks(text) : [];
              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "agent-message-enter max-w-[88%] self-end rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-3 text-sm leading-relaxed text-white shadow-[0_8px_20px_rgba(20,20,20,0.09)] sm:max-w-[78%]"
                      : "agent-message-enter w-full max-w-3xl self-start space-y-3 text-sm leading-7 text-[var(--ink)]"
                  }
                >
                  {text ? (
                    m.role === "assistant" ? <AgentMarkdown text={text} /> : <p className="break-words whitespace-pre-wrap">{text}</p>
                  ) : null}
                  {m.role === "assistant" ? <HodiActionCards actions={actionArtifacts} /> : null}
                  {sources.length ? (
                    <div className="flex flex-wrap items-center gap-1.5" aria-label="Sources cited by Hodi">
                      <span className="mr-1 text-[11px] font-medium text-[var(--ink-muted)]">Sources</span>
                      {sources.map((source, index) => {
                        let hostname = source;
                        try { hostname = new URL(source).hostname.replace(/^www\./, ""); } catch {}
                        return <a key={source} href={source} target="_blank" rel="noreferrer" className="max-w-44 truncate rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] font-medium text-[var(--brand)] transition hover:border-[var(--brand)]/40" title={source}>Source {index + 1}: {hostname}</a>;
                      })}
                    </div>
                  ) : null}
                  {reasoningParts.length > 0 || toolParts.length > 0 ? (
                    <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/70 text-[var(--ink)]">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium marker:hidden">
                        <Wrench className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                        Hodi activity
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
                        {reasoningParts.length > 0 ? <p className="rounded-lg bg-[var(--surface)]/70 px-2.5 py-2 text-xs leading-relaxed text-[var(--ink-muted)]">Hodi reviewed the available workspace context before responding.</p> : null}
                        {toolParts.map((part, index) => (
                          <div key={part.toolCallId || `${part.type}-${index}`} className="rounded border border-[var(--border)] bg-[var(--surface)]/70 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium">{humanizeToolName(part)}</p>
                              <span className="text-[11px] text-[var(--ink-muted)]">
                                {toolStateLabel(part.state)}
                              </span>
                            </div>
                            {safeToolError(part.state) || part.errorText ? <p className="mt-2 text-xs text-[var(--danger)]">{safeToolError(part.state) || "Hodi could not complete this action. Try again or adjust the request."}</p> : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {text ? (
                    <div className={`flex items-center gap-1 ${m.role === "user" ? "justify-end text-white/80" : "text-[var(--ink-muted)]"}`}>
                      <button type="button" onClick={() => void copyMessage(m.id, text)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition hover:bg-black/5 hover:text-[var(--ink)]" title="Copy message">
                        {copiedMessageId === m.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copiedMessageId === m.id ? "Copied" : "Copy"}
                      </button>
                      {m.role === "user" ? <button type="button" onClick={() => editAndResend(text)} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition hover:bg-white/15 disabled:opacity-50" title="Edit message"><Pencil className="h-3.5 w-3.5" />Edit</button> : <>
                        <button type="button" onClick={improveResponse} disabled={busy} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-50" title="Ask Hodi to improve this response"><RotateCcw className="h-3.5 w-3.5" />Improve</button>
                        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
                        <button type="button" onClick={() => setFeedback((current) => ({ ...current, [m.id]: "helpful" }))} aria-label="This response was helpful" aria-pressed={feedback[m.id] === "helpful"} className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ${feedback[m.id] === "helpful" ? "bg-[var(--surface-2)] text-[var(--brand)]" : ""}`}><ThumbsUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setFeedback((current) => ({ ...current, [m.id]: "not_helpful" }))} aria-label="This response was not helpful" aria-pressed={feedback[m.id] === "not_helpful"} className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ${feedback[m.id] === "not_helpful" ? "bg-[var(--surface-2)] text-[var(--danger)]" : ""}`}><ThumbsDown className="h-3.5 w-3.5" /></button>
                      </>}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          )}
          {busy ? (
            <p className="mx-auto mt-5 flex max-w-3xl items-center gap-2 text-sm text-[var(--ink-muted)]" aria-live="polite">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Hodi is working
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
          className="shrink-0 border-t border-[var(--border)]/80 bg-[var(--surface-raised)]/90 p-3 backdrop-blur sm:px-6 sm:py-4"
        >
          <div className="relative mx-auto max-w-3xl">
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
              className="block h-12 min-h-12 max-h-[112px] resize-none overflow-y-auto rounded-2xl border-[var(--border)] bg-[var(--surface-raised)] py-3 pl-4 pr-14 shadow-[0_8px_22px_rgba(20,20,20,0.05)]"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stop()}
                aria-label="Stop generating"
                title="Stop generating"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--ink)] text-white transition hover:scale-105 hover:bg-[var(--brand-strong)]"
              >
                <CircleStop className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!status?.ready || !input.trim()}
                aria-label="Send message"
                title="Send message"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--brand)] text-white transition hover:scale-105 hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-muted)]"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>
          </>}
        </div>
      </Card>
    </div>
  );
}
