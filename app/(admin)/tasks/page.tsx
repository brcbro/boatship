"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCheck, FileText, Inbox, MessageSquare, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, EmptyState, Kbd, PageHeader, Textarea } from "@/components/shared/ui";
import type { AppNotification, ClientWithProgress, FormSubmission, FormTemplate } from "@/types";

type MpcApproval = { approvalId: string; status: "pending" | "approved" | "rejected"; action: string; payload: Record<string, unknown>; requestedAt: string; requester: { id: string; name: string }; task: { id: string | null; title: string; clientId: string; status: string | null }; decision: { status: string; reason: string | null; reviewedAt: string; reviewerName: string } | null };
type TaskApproval = { id: string; taskId: string; status: string; note: string | null; createdAt: string; reviewedAt: string | null; task: { id: string; title: string; status: string; clientId: string } | null; client: { id?: string; companyName: string; name: string } | null };

type InboxType = "approval" | "form" | "message";
type Filter = "all" | InboxType;

/** One row of the triage list. Every row links to the place the work is handled. */
type InboxItem = {
  key: string;
  type: InboxType;
  title: string;
  detail: string;
  at: string;
  href: string;
  /** Approvals are decided inline, as before; the payload keeps the record. */
  approval?: { kind: "mcp"; record: MpcApproval } | { kind: "task"; record: TaskApproval };
  /** Unread message notifications behind a thread row; opening marks them read. */
  notificationIds?: string[];
};

const FILTERS: Array<{ id: Filter; label: string; icon: typeof Inbox }> = [
  { id: "all", label: "Everything", icon: Inbox },
  { id: "approval", label: "Approvals", icon: ClipboardCheck },
  { id: "form", label: "Form submissions", icon: FileText },
  { id: "message", label: "Messages", icon: MessageSquare },
];

function typeTone(type: InboxType): "warning" | "info" | "brand" {
  if (type === "approval") return "warning";
  if (type === "form") return "info";
  return "brand";
}

function typeLabel(type: InboxType) {
  if (type === "approval") return "Approval";
  if (type === "form") return "Form";
  return "Message";
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function InboxPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [mcp, setMcp] = useState<MpcApproval[]>([]);
  const [taskApprovals, setTaskApprovals] = useState<TaskApproval[]>([]);
  const [forms, setForms] = useState<Array<FormSubmission & { clientName: string }>>([]);
  const [templates, setTemplates] = useState<Map<string, FormTemplate>>(new Map());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    setMessage("");
    setLoading(true);
    const failures: string[] = [];
    const settle = <T,>(promise: Promise<T>, label: string, fallback: T) => promise.catch(() => { failures.push(label); return fallback; });
    try {
      const [mcpResult, taskResult, notificationResult, clientResult, templateResult] = await Promise.all([
        settle(apiFetch<{ approvals: MpcApproval[] }>("/api/mcp/approvals", { token }), "MCP requests", { approvals: [] }),
        settle(apiFetch<{ approvals: TaskApproval[] }>("/api/tasks/approvals", { token }), "task approvals", { approvals: [] }),
        settle(apiFetch<{ notifications: AppNotification[] }>("/api/notifications", { token }), "messages", { notifications: [] }),
        settle(apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token }), "clients", { clients: [] }),
        settle(apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", { token }), "form templates", { templates: [] }),
      ]);
      // Form submissions have no cross-client endpoint, so the Inbox reads
      // each visible client's forms and keeps the ones awaiting review.
      const perClient = await Promise.all(clientResult.clients.map((client) =>
        settle(apiFetch<{ forms: FormSubmission[] }>(`/api/forms?clientId=${encodeURIComponent(client.id)}`, { token }), `forms for ${client.companyName}`, { forms: [] })
          .then((data) => data.forms.filter((form) => form.status === "submitted").map((form) => ({ ...form, clientName: client.companyName || client.name })))
      ));
      setMcp(mcpResult.approvals);
      setTaskApprovals(taskResult.approvals);
      setNotifications(notificationResult.notifications);
      setForms(perClient.flat());
      setTemplates(new Map(templateResult.templates.map((template) => [template.id, template])));
      if (failures.length) setMessage(`Some of the Inbox could not load: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}.`);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Auth state becomes available on the client; load the protected queue then.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const items = useMemo<InboxItem[]>(() => {
    const rows: InboxItem[] = [];
    for (const item of mcp) {
      rows.push({
        key: `mcp:${item.approvalId}`,
        type: "approval",
        title: item.task.title,
        detail: `MCP ${item.action} · requested by ${item.requester.name}`,
        at: item.requestedAt,
        href: item.task.id ? `/clients/${item.task.clientId}?tab=tasks` : `/clients/${item.task.clientId}`,
        approval: { kind: "mcp", record: item },
      });
    }
    for (const item of taskApprovals) {
      rows.push({
        key: `task:${item.id}`,
        type: "approval",
        title: item.task?.title || "Task unavailable",
        detail: `Task completion · ${item.client?.companyName || "Project"}`,
        at: item.createdAt,
        href: item.task ? `/clients/${item.task.clientId}?tab=tasks` : "/clients",
        approval: { kind: "task", record: item },
      });
    }
    for (const form of forms) {
      rows.push({
        key: `form:${form.id}`,
        type: "form",
        title: templates.get(form.formTemplateId)?.name || form.formTemplateId,
        detail: `${form.clientName}${typeof form.riskScore === "number" ? ` · risk ${form.riskScore}` : ""}`,
        at: form.submittedAt || "",
        href: `/clients/${form.clientId}?tab=forms`,
      });
    }
    const threads = new Map<string, { notifications: AppNotification[] }>();
    for (const notification of notifications) {
      if (notification.kind !== "message" || notification.readAt || !notification.href) continue;
      const thread = threads.get(notification.href) || { notifications: [] };
      thread.notifications.push(notification);
      threads.set(notification.href, thread);
    }
    for (const [href, thread] of threads) {
      const latest = [...thread.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      rows.push({
        key: `thread:${href}`,
        type: "message",
        title: latest.title,
        detail: thread.notifications.length > 1 ? `${thread.notifications.length} unread · “${latest.body}”` : `“${latest.body}”`,
        at: latest.createdAt,
        href,
        notificationIds: thread.notifications.map((item) => item.id),
      });
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }, [mcp, taskApprovals, forms, templates, notifications]);

  const counts = useMemo(() => ({
    all: items.length,
    approval: items.filter((item) => item.type === "approval").length,
    form: items.filter((item) => item.type === "form").length,
    message: items.filter((item) => item.type === "message").length,
  }), [items]);

  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => item.type === filter), [items, filter]);

  // The highlighted row is clamped to the list, so a decision that removes the
  // last row moves the highlight up instead of leaving it dangling.
  const selectedIndex = Math.min(selected, Math.max(0, visible.length - 1));

  const openItem = useCallback(async (item: InboxItem) => {
    if (item.notificationIds?.length) {
      // Opening a thread from the Inbox counts as reading its notifications,
      // the same as choosing them from the bell.
      await Promise.all(item.notificationIds.map((id) => apiFetch("/api/notifications", { method: "PATCH", token, body: JSON.stringify({ id }) }).catch(() => undefined)));
      setNotifications((current) => current.map((notification) => item.notificationIds?.includes(notification.id) ? { ...notification, readAt: new Date().toISOString() } : notification));
    }
    router.push(item.href);
  }, [router, token]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!visible.length) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelected(Math.min(selectedIndex + 1, visible.length - 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected(Math.max(selectedIndex - 1, 0));
      } else if (event.key === "Enter") {
        const item = visible[selectedIndex];
        if (!item) return;
        event.preventDefault();
        if (item.approval) setExpanded((current) => current === item.key ? null : item.key);
        else void openItem(item);
      } else if (event.key === "o") {
        const item = visible[selectedIndex];
        if (!item) return;
        event.preventDefault();
        void openItem(item);
      } else if (event.key === "Escape" && expanded) {
        setExpanded(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, selectedIndex, expanded, openItem]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, visible.length]);

  async function reviewMcp(approvalId: string, decision: "approved" | "rejected") {
    setBusy(approvalId); setMessage("");
    try { await apiFetch("/api/mcp/approvals", { method: "POST", token, body: JSON.stringify({ approvalId, decision, reason: reason[approvalId] || "" }) }); setReason((current) => ({ ...current, [approvalId]: "" })); setExpanded(null); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review MCP request"); } finally { setBusy(null); }
  }

  async function reviewTask(taskId: string, status: "approved" | "rejected") {
    setBusy(taskId); setMessage("");
    try { await apiFetch(`/api/tasks/${taskId}/approval`, { method: "POST", token, body: JSON.stringify({ status, reason: reason[taskId] || "" }) }); setReason((current) => ({ ...current, [taskId]: "" })); setExpanded(null); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review task"); } finally { setBusy(null); }
  }

  function reviewPanel(item: InboxItem) {
    if (!item.approval) return null;
    const id = item.approval.kind === "mcp" ? item.approval.record.approvalId : item.approval.record.taskId;
    const disabled = busy === id;
    return (
      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-4 sm:px-5">
        {item.approval.kind === "mcp" ? <pre className="mb-3 max-h-32 overflow-auto rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3 font-[family-name:var(--font-mono)] text-[11px] leading-5 text-[var(--ink-muted)]">{JSON.stringify(item.approval.record.payload, null, 2)}</pre> : null}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-[var(--ink)]">{item.approval.kind === "mcp" ? "Reason or reviewer note" : "Decision reason"}</span>
          <Textarea value={reason[id] || ""} onChange={(event) => setReason((current) => ({ ...current, [id]: event.target.value }))} placeholder="Optional for approval; required for rejection" rows={2} />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Link href={item.href} prefetch={false} className="text-[13px] font-semibold text-[var(--brand)] hover:underline">Open the task</Link>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => item.approval?.kind === "mcp" ? void reviewMcp(id, "rejected") : void reviewTask(id, "rejected")}><X className="h-4 w-4" />Reject</Button>
            <Button size="sm" disabled={disabled || (item.approval.kind === "task" && !item.approval.record.task)} onClick={() => item.approval?.kind === "mcp" ? void reviewMcp(id, "approved") : void reviewTask(id, "approved")}><Check className="h-4 w-4" />{item.approval.kind === "mcp" ? "Approve request" : "Approve completion"}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Everything waiting on a person: approvals to decide, form submissions to review and client messages to answer."
        actions={<Button variant="secondary" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Refresh</Button>}
      />

      {message ? <div className="rounded-[var(--radius-lg)] border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">{message}</div> : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by type">
        {FILTERS.map((chip) => {
          const Icon = chip.icon;
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              onClick={() => { setFilter(chip.id); setSelected(0); setExpanded(null); }}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors",
                active ? "border-transparent bg-[var(--brand)] text-[var(--on-brand)]" : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:border-[var(--ink-faint)] hover:text-[var(--ink)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {chip.label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-[var(--on-brand)]/15" : "bg-[var(--surface-2)]")}>{counts[chip.id]}</span>
            </button>
          );
        })}
        <p className="ml-auto hidden items-center gap-1.5 text-xs text-[var(--ink-muted)] md:flex">
          <Kbd>j</Kbd><Kbd>k</Kbd> move · <Kbd>↵</Kbd> review or open · <Kbd>o</Kbd> open
        </p>
      </div>

      {loading && items.length === 0 ? (
        <p role="status" className="text-sm text-[var(--ink-muted)]">Loading your inbox…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "Inbox zero" : `No ${FILTERS.find((chip) => chip.id === filter)?.label.toLowerCase()} waiting`}
          description="New approvals, submitted forms and unread client messages will appear here as they arrive."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ol ref={listRef} className="divide-y divide-[var(--border)]" aria-label="Items needing attention">
            {visible.map((item, index) => {
              const current = index === selectedIndex;
              const open = expanded === item.key;
              return (
                <li key={item.key} data-index={index} className={cn(current && "bg-[var(--brand-soft)]/60")}>
                  <div className="flex items-stretch">
                    <span aria-hidden="true" className={cn("w-[3px] shrink-0", current ? "bg-[var(--accent)]" : "bg-transparent")} />
                    <button
                      type="button"
                      onClick={() => { setSelected(index); if (item.approval) setExpanded(open ? null : item.key); else void openItem(item); }}
                      aria-expanded={item.approval ? open : undefined}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-[var(--surface-2)]/60 sm:px-4"
                    >
                      <Badge tone={typeTone(item.type)} className="hidden shrink-0 sm:inline-flex">{typeLabel(item.type)}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.title}</span>
                        <span className="block truncate text-xs text-[var(--ink-muted)]">{item.detail}</span>
                      </span>
                      <time dateTime={item.at || undefined} className="hidden shrink-0 text-xs tabular-nums text-[var(--ink-muted)] sm:block">{item.at ? formatDateTime(item.at) : "—"}</time>
                    </button>
                    {item.approval ? (
                      <Link href={item.href} prefetch={false} onClick={() => setSelected(index)} className="hidden shrink-0 items-center px-4 text-[13px] font-semibold text-[var(--brand)] hover:underline sm:flex">Open</Link>
                    ) : null}
                  </div>
                  {open ? reviewPanel(item) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}
