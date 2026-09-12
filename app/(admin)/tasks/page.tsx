"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, RefreshCw, ShieldAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Badge, Button, Card, EmptyState, PageHeader, Textarea } from "@/components/shared/ui";

type MpcApproval = { approvalId: string; status: "pending" | "approved" | "rejected"; action: string; payload: Record<string, unknown>; requestedAt: string; requester: { id: string; name: string }; task: { id: string | null; title: string; clientId: string; status: string | null }; decision: { status: string; reason: string | null; reviewedAt: string; reviewerName: string } | null };
type TaskApproval = { id: string; taskId: string; status: string; note: string | null; createdAt: string; reviewedAt: string | null; task: { id: string; title: string; status: string; clientId: string } | null; client: { companyName: string; name: string } | null };

function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : "—"; }

export default function TaskApprovalsPage() {
  const [mcp, setMcp] = useState<MpcApproval[]>([]);
  const [tasks, setTasks] = useState<TaskApproval[]>([]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setMessage("");
    try {
      const [mcpResult, taskResult] = await Promise.all([
        apiFetch<{ approvals: MpcApproval[] }>("/api/mcp/approvals"),
        apiFetch<{ approvals: TaskApproval[] }>("/api/tasks/approvals"),
      ]);
      setMcp(mcpResult.approvals);
      setTasks(taskResult.approvals);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load approvals"); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function reviewMcp(approvalId: string, decision: "approved" | "rejected") {
    setBusy(approvalId); setMessage("");
    try { await apiFetch("/api/mcp/approvals", { method: "POST", body: JSON.stringify({ approvalId, decision, reason: reason[approvalId] || "" }) }); setReason((current) => ({ ...current, [approvalId]: "" })); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review MCP request"); } finally { setBusy(null); }
  }

  async function reviewTask(taskId: string, status: "approved" | "rejected") {
    setBusy(taskId); setMessage("");
    try { await apiFetch(`/api/tasks/${taskId}/approval`, { method: "POST", body: JSON.stringify({ status, reason: reason[taskId] || "" }) }); setReason((current) => ({ ...current, [taskId]: "" })); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to review task"); } finally { setBusy(null); }
  }

  return <div className="space-y-8">
    <PageHeader title="Approval queue" description="Review MCP write requests and task completion evidence before changes become final." actions={<Button variant="secondary" onClick={() => void load()} disabled={Boolean(busy)}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
    {message ? <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/8 px-4 py-3 text-sm text-[var(--danger)]" role="alert">{message}</div> : null}
    <section aria-labelledby="mcp-approvals-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3"><div><h2 id="mcp-approvals-heading" className="font-[family-name:var(--font-display)] text-xl">MCP write requests</h2><p className="text-sm text-[var(--ink-muted)]">Agent actions remain paused until an authorized reviewer approves them.</p></div><Badge tone={mcp.length ? "warning" : "success"}>{mcp.length} pending</Badge></div>
      {mcp.length === 0 ? <EmptyState title="No MCP writes waiting" description="New status changes, comments, follow-ups, reviews, and evidence attachments will appear here." /> : <div className="grid gap-4 xl:grid-cols-2">{mcp.map((item) => <Card key={item.approvalId} className="space-y-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="warning">Needs review</Badge><code className="text-xs text-[var(--ink-muted)]">{item.action}</code></div><h3 className="mt-2 font-semibold">{item.task.title}</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">Requested by {item.requester.name} · {date(item.requestedAt)}</p></div><Clock3 className="h-5 w-5 shrink-0 text-[var(--warning)]" aria-hidden="true" /></div><pre className="max-h-24 overflow-auto rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--ink-muted)]">{JSON.stringify(item.payload, null, 2)}</pre><label className="block"><span className="mb-1.5 block text-sm font-medium">Reason or reviewer note</span><Textarea value={reason[item.approvalId] || ""} onChange={(event) => setReason((current) => ({ ...current, [item.approvalId]: event.target.value }))} placeholder="Optional for approval; required for rejection" rows={2} /></label><div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => void reviewMcp(item.approvalId, "rejected")} disabled={busy === item.approvalId}><X className="h-4 w-4" />Reject</Button><Button onClick={() => void reviewMcp(item.approvalId, "approved")} disabled={busy === item.approvalId}><Check className="h-4 w-4" />Approve request</Button></div></Card>)}</div>}
    </section>
    <section aria-labelledby="task-approvals-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3"><div><h2 id="task-approvals-heading" className="font-[family-name:var(--font-display)] text-xl">Task completion</h2><p className="text-sm text-[var(--ink-muted)]">Confirm the work is ready before a task moves to completed.</p></div><Badge tone={tasks.length ? "warning" : "success"}>{tasks.length} pending</Badge></div>
      {tasks.length === 0 ? <EmptyState title="No task completions waiting" description="Tasks requiring manager approval will be listed here after validation." /> : <div className="grid gap-4 xl:grid-cols-2">{tasks.map((item) => <Card key={item.id} className="space-y-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="warning">Needs review</Badge><span className="text-xs text-[var(--ink-muted)]">{item.client?.companyName || "Project"}</span></div><h3 className="mt-2 font-semibold">{item.task?.title || "Task unavailable"}</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">Requested {date(item.createdAt)}{item.reviewedAt ? ` · reviewed ${date(item.reviewedAt)}` : ""}</p></div><ShieldAlert className="h-5 w-5 shrink-0 text-[var(--warning)]" aria-hidden="true" /></div><label className="block"><span className="mb-1.5 block text-sm font-medium">Decision reason</span><Textarea value={reason[item.taskId] || ""} onChange={(event) => setReason((current) => ({ ...current, [item.taskId]: event.target.value }))} placeholder="Optional for approval; required for rejection" rows={2} /></label><div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => void reviewTask(item.taskId, "rejected")} disabled={busy === item.taskId}><X className="h-4 w-4" />Reject</Button><Button onClick={() => void reviewTask(item.taskId, "approved")} disabled={busy === item.taskId || !item.task}><Check className="h-4 w-4" />Approve completion</Button></div></Card>)}</div>}
    </section>
  </div>;
}
