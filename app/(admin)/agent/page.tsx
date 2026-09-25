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
  ChevronDown,
  Check,
  CircleStop,
  Copy,
  HardDrive,
  LoaderCircle,
  PanelLeft,
  Pencil,
  Plus,
  PlugZap,
  RotateCcw,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type AgentStatus = {
  userId?: string;
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

type ActionProposal = {
  id: string;
  action: string;
  userId: string;
  payload: Record<string, unknown>;
  approvalToken: string;
  expiresAt: string;
  preview: { title: string; changes?: string[]; diff?: Array<{ label: string; before: string; after: string }> };
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
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const [proposals, setProposals] = useState<ActionProposal[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionResultHref, setActionResultHref] = useState<string | null>(null);
  const [completedAction, setCompletedAction] = useState<{ action: string; ids: Record<string, string> } | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const historyDrawerRef = useRef<HTMLDivElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const stickToBottomRef = useRef(true);
  const wasBusyRef = useRef(false);
  const lastSubmittedRef = useRef("");
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
  const latestMessageText = messageText((messages.at(-1)?.parts || []) as AgentMessagePart[]);
  const connectedConnectors = status?.connectors.filter((connector) => connector.connected) ?? [];
  const connectedConnectorCount = connectedConnectors.length;
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  const loadProposals = useCallback(async () => {
    if (!token) return;
    try {
      const result = await apiFetch<{ proposals: ActionProposal[] }>("/api/hodi/actions?status=pending", { token });
      setProposals(result.proposals.filter((proposal) => proposal.userId === status?.userId));
    } catch { setActionFeedback("Action proposals could not load. Refresh this page to retry."); }
  }, [token, status?.userId]);

  useEffect(() => {
    if (!status?.userId || busy) return;
    const timer = window.setTimeout(() => void loadProposals(), 0);
    return () => window.clearTimeout(timer);
  }, [busy, status?.userId, loadProposals]);

  async function decideProposal(proposal: ActionProposal, approved: boolean) {
    if (!token || actionBusy || busy) return;
    setActionBusy(proposal.id);
    setActionFeedback(null);
    setActionResultHref(null);
    setCompletedAction(null);
    try {
      if (approved) {
        const response = await apiFetch<{ result: { href?: string; url?: string; client?: { id?: string }; event?: { htmlLink?: string | null } } }>("/api/agent/actions/execute", {
          token, method: "POST", body: JSON.stringify({ action: proposal.action, payload: proposal.payload, approvalToken: proposal.approvalToken }),
        });
        setActionFeedback(`${proposal.preview.title} completed.`);
        const result = response.result;
        setActionResultHref(result.href || result.url || result.event?.htmlLink || (result.client?.id ? `/clients/${result.client.id}` : null));
        const ids = Object.fromEntries(Object.entries(result).flatMap(([key, value]) => {
          if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") return [];
          return [[key, value.id]];
        }));
        setCompletedAction({ action: proposal.action, ids });
      } else {
        await apiFetch("/api/hodi/actions", {
          token, method: "POST", body: JSON.stringify({ id: proposal.id, status: "rejected", reason: "Declined in Hodi chat" }),
        });
        setActionFeedback(`${proposal.preview.title} declined.`);
      }
      await loadProposals();
    } catch (cause) {
      setActionFeedback(cause instanceof Error ? cause.message : "The action could not be completed. Please retry.");
    } finally { setActionBusy(null); }
  }

  function continuePlan() {
    if (!completedAction || busy || !activeSessionId) return;
    const text = `The approved ${completedAction.action} action completed. Created record IDs: ${JSON.stringify(completedAction.ids)}. Continue the remaining steps of my earlier request. Prepare the next action for my review and use these IDs where needed.`;
    setCompletedAction(null);
    lastSubmittedRef.current = text;
    void sendMessage({ text }).catch(() => setInput(text));
  }

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setHistoryError(null);
    try {
      const { sessions: existing } = await apiFetch<{ sessions: ChatSession[] }>("/api/agent/history", { token });
      const initial = existing[0] || (await apiFetch<{ session: ChatSession }>("/api/agent/history", {
        method: "POST", token, body: JSON.stringify({}),
      })).session;
      setSessions(existing.length ? existing : [initial]);
      setActiveSessionId((current) => current && existing.some((item) => item.id === current) ? current : initial.id);
    } catch {
      setHistoryError("Chats could not load. Retry to continue.");
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSessions]);

  useEffect(() => {
    if (!token || !activeSessionId) return;
    let cancelled = false;
    setMessages([]);
    void apiFetch<{ messages: StoredAgentMessage[] }>(
      `/api/agent/history?sessionId=${encodeURIComponent(activeSessionId)}`,
      { token }
    )
      .then(({ messages: history }) => {
        if (cancelled) return;
        const orderedMessages = [...history].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt)
        );
        setMessages(orderedMessages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: [{ type: "text" as const, text: message.text }],
        })));
      })
      .catch(() => { if (!cancelled) setHistoryError("This chat could not load. Select another chat or retry."); });
    return () => { cancelled = true; };
  }, [token, activeSessionId, historyReload, setMessages]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const transcript = transcriptRef.current;
    transcript?.scrollTo({ top: transcript.scrollHeight, behavior: "instant" });
  }, [messages.length, latestMessageText, busy]);

  useEffect(() => {
    if (wasBusyRef.current && !busy && token) {
      void apiFetch<{ sessions: ChatSession[] }>("/api/agent/history", { token })
        .then(({ sessions: latest }) => setSessions(latest))
        .catch(() => setHistoryError("Chat titles could not refresh. Retry to load your chats."));
    }
    wasBusyRef.current = busy;
  }, [busy, token]);

  useEffect(() => {
    if (!error || !lastSubmittedRef.current) return;
    const timer = window.setTimeout(() => setInput((current) => current || lastSubmittedRef.current), 0);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!mobileHistoryOpen) return;
    const historyTrigger = historyTriggerRef.current;
    historyCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileHistoryOpen(false);
        return;
      }
      if (event.key !== "Tab" || !historyDrawerRef.current) return;
      const focusable = Array.from(historyDrawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      historyTrigger?.focus();
    };
  }, [mobileHistoryOpen]);

  function selectSession(id: string) {
    stickToBottomRef.current = true;
    setNearBottom(true);
    setActiveSessionId(id);
    setMobileHistoryOpen(false);
  }

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
    const timer = setTimeout(() => void loadStatus(), 0);
    return () => clearTimeout(timer);
  }, [loadStatus]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !status?.ready || !activeSessionId) return;
    stickToBottomRef.current = true;
    lastSubmittedRef.current = text;
    setInput("");
    if (composerRef.current) {
      composerRef.current.style.height = "44px";
      composerRef.current.style.overflowY = "hidden";
    }
    try {
      await sendMessage({ text });
    } catch {
      setInput(text);
    }
  }

  function runSuggestion(text: string) {
    if (busy || !status?.ready || !activeSessionId) return;
    stickToBottomRef.current = true;
    lastSubmittedRef.current = text;
    void sendMessage({ text }).catch(() => setInput((current) => current || text));
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
    const text = "Improve your previous response. Keep it concise, cite the workspace evidence you used, and state any assumptions or next action clearly.";
    lastSubmittedRef.current = text;
    void sendMessage({ text }).catch(() => setInput((current) => current || text));
  }

  async function newChat() {
    if (!token || busy) return;
    try {
      const { session } = await apiFetch<{ session: ChatSession }>("/api/agent/history", {
        method: "POST", token, body: JSON.stringify({}),
      });
      setSessions((current) => [session, ...current]);
      selectSession(session.id);
    } catch { setHistoryError("Could not create a chat. Please try again."); }
  }

  async function deleteActiveChat() {
    if (!token || !activeSessionId || busy) return;
    try {
      await apiFetch(`/api/agent/history?sessionId=${encodeURIComponent(activeSessionId)}`, {
        method: "DELETE", token,
      });
      const remaining = sessions.filter((session) => session.id !== activeSessionId);
      setSessions(remaining);
      setConfirmDelete(false);
      if (remaining[0]) selectSession(remaining[0].id);
      else await newChat();
    } catch { setHistoryError("Could not delete this chat. Please try again."); }
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--surface)]">
        <aside className={`hodi-history-rail md:static md:z-auto md:flex md:bg-transparent ${mobileHistoryOpen ? "fixed inset-0 z-50 flex bg-black/35" : "hidden"}`} aria-label="Chat history">
          {mobileHistoryOpen ? <button type="button" className="absolute inset-0 md:hidden" aria-label="Close chat history" onClick={() => setMobileHistoryOpen(false)} /> : null}
          <div ref={historyDrawerRef} role={mobileHistoryOpen ? "dialog" : undefined} aria-modal={mobileHistoryOpen ? true : undefined} aria-label={mobileHistoryOpen ? "Chat history" : undefined} className="relative flex h-full w-[min(19rem,85vw)] flex-col border-r border-[var(--border)] bg-[var(--surface-raised)] md:w-full">
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between md:hidden"><span className="font-medium">Chats</span><button ref={historyCloseRef} type="button" onClick={() => setMobileHistoryOpen(false)} className="rounded-lg px-3 py-2 text-sm">Close</button></div>
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
                  onClick={() => selectSession(session.id)}
                  disabled={busy}
                  aria-current={session.id === activeSessionId ? "page" : undefined}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition duration-200 ${session.id === activeSessionId ? "bg-[var(--surface-2)] font-medium text-[var(--ink)] shadow-[inset_2px_0_0_var(--brand)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"}`}
                >
                  <span className="block truncate">{session.title}</span>
                  <span className="mt-0.5 block text-xs font-normal text-[var(--ink-muted)]">{new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </button>
              ))}
            </div>
          </div>
          </div>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]">
          <header className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button ref={historyTriggerRef} type="button" aria-label="Open chat history" onClick={() => setMobileHistoryOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink)] hover:bg-[var(--surface-2)] md:hidden"><PanelLeft className="h-5 w-5" /></button>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(20,20,20,0.14)]" aria-hidden="true">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-[family-name:var(--font-display)] text-base text-[var(--ink)]">{activeSession?.title || "Hodi"}</p>
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
              {activeSessionId ? <button type="button" aria-label="Delete chat" title="Delete chat" onClick={() => setConfirmDelete(true)} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--danger)] disabled:opacity-50"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Delete</span></button> : null}
            </div>
          </header>
          {historyError ? <div role="alert" className="flex items-center justify-between gap-3 border-b border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-2 text-sm text-[var(--danger)]"><span>{historyError}</span><button type="button" onClick={() => { void loadSessions(); setHistoryReload((current) => current + 1); }} className="shrink-0 font-medium underline underline-offset-2">Retry</button></div> : null}
          {confirmDelete ? <div role="group" aria-label="Confirm chat deletion" className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm"><span>Delete this chat and its messages?</span><div className="flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button type="button" size="sm" onClick={() => void deleteActiveChat()}>Delete chat</Button></div></div> : null}

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
        <div ref={transcriptRef} onScroll={(event) => { const element = event.currentTarget; const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100; stickToBottomRef.current = atBottom; setNearBottom((current) => current === atBottom ? current : atBottom); }} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-8 [scroll-padding-bottom:8rem] sm:px-8">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-xl flex-col justify-center space-y-6 py-8">
              <div className="space-y-2 text-center agent-message-enter">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-[0_10px_24px_rgba(20,20,20,0.14)]">
                  <Bot className="h-6 w-6" />
                </span>
                <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.02em] text-[var(--ink)]">What can I help with?</h1>
                <p className="text-sm leading-6 text-[var(--ink-muted)]">Ask about clients, onboarding, and project work. Hodi can prepare drafts and propose actions using your connected apps.</p>
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
                        <ChevronDown className="ml-auto h-4 w-4 text-[var(--ink-muted)] transition group-open:rotate-180" />
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
                      </>}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          )}
          {proposals.length > 0 ? <section className="mx-auto mt-6 max-w-3xl space-y-3" aria-label="Hodi actions awaiting approval">
            {proposals.map((proposal) => <div key={proposal.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Review action</p>
              <h2 className="mt-1 font-medium text-[var(--ink)]">{proposal.preview.title}</h2>
              {proposal.preview.changes?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--ink-muted)]">{proposal.preview.changes.map((change, index) => <li key={`${index}-${change}`}>{change}</li>)}</ul> : null}
              {proposal.preview.diff?.length ? <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-[var(--border)] pt-3 text-xs sm:grid-cols-[8rem_1fr]">{proposal.preview.diff.map((change, index) => <div key={`${change.label}-${index}`} className="contents"><dt className="font-medium text-[var(--ink-muted)]">{change.label}</dt><dd className="break-words text-[var(--ink)]">{change.after}</dd></div>)}</dl> : null}
              <p className="mt-2 text-xs text-[var(--ink-muted)]">Expires {new Date(proposal.expiresAt).toLocaleString()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || Boolean(actionBusy)} onClick={() => void decideProposal(proposal, true)}>{actionBusy === proposal.id ? "Working…" : "Approve and create"}</Button>
                <Button size="sm" variant="secondary" disabled={busy || Boolean(actionBusy)} onClick={() => void decideProposal(proposal, false)}>Decline</Button>
              </div>
            </div>)}
          </section> : null}
          {actionFeedback ? <div role="status" className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-3 text-sm text-[var(--ink-muted)]"><span>{actionFeedback}</span>{actionResultHref ? <Link href={actionResultHref} className="font-medium text-[var(--brand)] underline underline-offset-2">Open result</Link> : null}{completedAction ? <button type="button" onClick={continuePlan} disabled={busy} className="font-medium text-[var(--brand)] underline underline-offset-2 disabled:opacity-50">Continue plan</button> : null}</div> : null}
          {busy ? (
            <p className="mx-auto mt-5 flex max-w-3xl items-center gap-2 text-sm text-[var(--ink-muted)]" aria-live="polite">
              <LoaderCircle className="h-4 w-4 animate-spin" /> {(messages.at(-1)?.parts as AgentMessagePart[] | undefined)?.some((part) => (part.type.startsWith("tool-") || part.type === "dynamic-tool") && part.state !== "output-available") ? "Hodi is using workspace tools" : "Hodi is preparing a response"}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
              {error.message}
            </p>
          ) : null}
        </div>
        {!nearBottom && messages.length > 0 ? <button type="button" onClick={() => { stickToBottomRef.current = true; transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); setNearBottom(true); }} className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-xs font-medium shadow-md">Jump to latest</button> : null}

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="shrink-0 border-t border-[var(--border)]/80 bg-[var(--surface-raised)]/90 p-3 backdrop-blur sm:px-6 sm:py-4"
        >
          <div className="relative mx-auto max-w-3xl">
            <label htmlFor="hodi-composer" className="mb-1.5 block text-xs font-medium text-[var(--ink)]">Message Hodi</label>
            <Textarea
              id="hodi-composer"
              ref={composerRef}
              rows={1}
              placeholder={
                status?.ready
                  ? "Ask about onboarding health, blockers, folders, or a follow-up draft…"
                  : "Finish setup above to chat"
              }
              value={input}
              disabled={!status?.ready || busy || !activeSessionId}
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
              className="block h-12 min-h-12 max-h-[112px] resize-none overflow-y-auto rounded-2xl border-[var(--border)] bg-[var(--surface-raised)] py-3 pl-4 pr-14"
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
                disabled={!status?.ready || !activeSessionId || !input.trim()}
                aria-label="Send message"
                title="Send message"
                className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl bg-[var(--brand)] text-white transition hover:scale-105 hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-muted)]"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
            <p className="mt-1.5 hidden text-[11px] text-[var(--ink-muted)] sm:block">Enter to send · Shift+Enter for a new line</p>
          </div>
        </form>
          </>}
        </div>
    </div>
  );
}
