"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { HardDrive, Sparkles } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, PageHeader, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type AgentStatus = {
  composioConfigured: boolean;
  llmConfigured: boolean;
  driveConnected: boolean;
  ready: boolean;
  message: string | null;
};

const SUGGESTIONS = [
  "List recent files in my Drive",
  "Create a folder named Onboarding — Acme Shipping",
  "Find folders that mention onboarding",
  "Summarize what is in My Drive root",
];

function messageText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

export default function AgentPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent/chat",
        headers: () => ({
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }),
      }),
    [token]
  );

  const { messages, sendMessage, status: chatStatus, error, setMessages } = useChat({
    transport,
  });

  const busy = chatStatus === "submitted" || chatStatus === "streaming";

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
    if (!text || busy || !status?.ready) return;
    setInput("");
    await sendMessage({ text });
  }

  function runSuggestion(text: string) {
    if (busy || !status?.ready) return;
    void sendMessage({ text });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Drive Agent"
        description="Chat with your connected Google Drive. Connections are per team member — only your Drive is in scope."
        actions={
          <Link
            href="/integrations"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
          >
            <HardDrive className="h-4 w-4" />
            Integrations
          </Link>
        }
      />

      {statusLoading ? (
        <p className="text-sm text-[var(--ink-muted)]">Checking Drive agent…</p>
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
              OPENAI_API_KEY (or AI_GATEWAY_API_KEY)
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
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
          <Badge tone="success">Drive ready</Badge>
          <span>Using your personal Composio connection</span>
          <button
            type="button"
            className="underline hover:text-[var(--ink)]"
            onClick={() => void loadStatus()}
          >
            Refresh
          </button>
        </div>
      )}

      <Card className="flex min-h-[420px] flex-col p-0 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {messages.length === 0 ? (
            <div className="space-y-4 py-6">
              <p className="text-sm text-[var(--ink-muted)]">
                Try a Drive task — the agent will call Composio tools against your account.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!status?.ready || busy}
                    onClick={() => runSuggestion(s)}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-left text-sm text-[var(--ink)] transition hover:border-[var(--ink)]/30 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const text = messageText(m.parts as Array<{ type: string; text?: string }>);
              const toolParts = (m.parts as Array<{ type: string }>).filter((p) =>
                p.type.startsWith("tool-")
              );
              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-8 rounded-lg bg-[var(--brand)] px-3 py-2 text-sm text-white"
                      : "mr-8 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]"
                  }
                >
                  {text ? <p className="whitespace-pre-wrap">{text}</p> : null}
                  {toolParts.length > 0 ? (
                    <p className="text-xs text-[var(--ink-muted)]">
                      Used {toolParts.length} Drive tool{toolParts.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
          {busy ? (
            <p className="text-sm text-[var(--ink-muted)]">Working with Drive…</p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
              {error.message}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              rows={2}
              placeholder={
                status?.ready
                  ? "Ask about folders, create a client Drive folder…"
                  : "Finish setup above to chat"
              }
              value={input}
              disabled={!status?.ready || busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit(e);
                }
              }}
              className="min-h-[72px] resize-none"
            />
            <div className="flex gap-2 sm:flex-col">
              <Button type="submit" disabled={!status?.ready || busy || !input.trim()}>
                {busy ? "…" : "Send"}
              </Button>
              {messages.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setMessages([])}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
