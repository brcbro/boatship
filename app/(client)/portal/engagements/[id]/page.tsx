"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";
import type { DocumentRecord, FormSubmission, Task } from "@/types";
type Operations = { milestones: Array<{ id: string; title: string; status: string; engagementId?: string | null; dueDate: string | null }>; approvals: Array<{ id: string; subject: string; status: string; engagementId?: string | null }> };

type Engagement = {
  id: string;
  clientId: string;
  name: string;
  type: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
  progress: number;
};

export default function PortalEngagementPage() {
  const { id } = useParams<{ id: string }>();
  const { session, token, loading: authLoading } = useAuth();
  const clientId = session?.clientId;
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [operations, setOperations] = useState<Operations>({ milestones: [], approvals: [] });
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resourceError, setResourceError] = useState("");

  const load = useCallback(async () => {
    if (!clientId || !id) { setLoading(false); return; }
    setLoading(true);
    setError("");
    setResourceError("");
    try {
      const query = `clientId=${encodeURIComponent(clientId)}&engagementId=${encodeURIComponent(id)}&includeAccountWide=true`;
      const [detail, taskList, resources] = await Promise.all([
        apiFetch<{ engagement: Engagement }>(`/api/engagements/${encodeURIComponent(id)}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(clientId)}&engagementId=${encodeURIComponent(id)}`, { token }),
        Promise.allSettled([
          apiFetch<Operations>(`/api/project-operations?${query}`, { token }),
          apiFetch<{ documents: DocumentRecord[] }>(`/api/documents?${query}`, { token }),
          apiFetch<{ forms: FormSubmission[] }>(`/api/forms?${query}`, { token }),
        ]),
      ]);
      setEngagement(detail.engagement);
      setTasks(taskList.tasks.filter((task) => task.type === "client_facing").sort((a, b) => a.order - b.order));
      setOperations(resources[0].status === "fulfilled" ? resources[0].value : { milestones: [], approvals: [] });
      setDocuments(resources[1].status === "fulfilled" ? resources[1].value.documents : []);
      setForms(resources[2].status === "fulfilled" ? resources[2].value.forms : []);
      if (resources.some((result) => result.status === "rejected")) setResourceError("Some engagement resources could not load. Open their section below to retry; your tasks are still available.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load this engagement.");
    } finally { setLoading(false); }
  }, [id, clientId, token]);

  useEffect(() => { if (authLoading) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [authLoading, load]);

  if (authLoading || loading) return <div><PageHeader title="Engagement" description="Loading engagement…" /><Card className="text-sm text-[var(--ink-muted)]">Loading…</Card></div>;
  if (error || !engagement) return <div><PageHeader title="Engagement" /><Card><p role="alert" className="text-sm text-[var(--ink-muted)]">{error || "This engagement is unavailable."}</p><Link href="/portal/engagements" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand)]">Back to engagements</Link></Card></div>;

  const openTasks = tasks.filter((task) => task.status !== "completed");
  const completedTasks = tasks.length - openTasks.length;

  return <div className="space-y-7">
    <Link href="/portal/engagements" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--brand)] hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> All engagements</Link>
    <PageHeader title={engagement.name} description={`${statusLabel(engagement.type)} · ${statusLabel(engagement.status)}`} />
    {resourceError ? <p role="alert" className="text-sm text-[var(--danger)]">{resourceError}</p> : null}
    <section aria-label="Engagement summary" className="grid gap-4 sm:grid-cols-3">
      <Card><p className="text-sm text-[var(--ink-muted)]">Status</p><p className="mt-2 text-lg font-semibold text-[var(--ink)]">{statusLabel(engagement.status)}</p></Card>
      <Card><p className="text-sm text-[var(--ink-muted)]">Your tasks complete</p><p className="mt-2 text-lg font-semibold tabular-nums text-[var(--ink)]">{completedTasks} of {tasks.length}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{engagement.progress}% of your tasks complete</p></Card>
      <Card><p className="text-sm text-[var(--ink-muted)]">Timeline</p><p className="mt-2 text-sm font-medium text-[var(--ink)]">{engagement.completedAt ? `Finished ${formatDate(engagement.completedAt)}` : engagement.targetDate ? `Target ${formatDate(engagement.targetDate)}` : engagement.startDate ? `Started ${formatDate(engagement.startDate)}` : "Dates to be confirmed"}</p></Card>
    </section>
    <section aria-labelledby="engagement-tasks"><div className="mb-3 flex items-center justify-between gap-3"><h2 id="engagement-tasks" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Your tasks</h2><Link href="/portal/tasks" className="text-sm font-semibold text-[var(--brand)] hover:underline">All tasks</Link></div><Card className="divide-y divide-[var(--border)] p-0">{tasks.length ? tasks.map((task) => <Link key={task.id} href={`/portal/tasks?taskId=${encodeURIComponent(task.id)}`} className="flex min-h-16 items-center justify-between gap-3 px-5 py-3 transition hover:bg-[var(--surface-2)]"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{task.title}</span><span className="mt-1 block text-xs text-[var(--ink-muted)]">{task.dueDate ? `Due ${formatDate(task.dueDate)} · ` : ""}{statusLabel(task.status)}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden="true" /></Link>) : <p className="px-5 py-5 text-sm text-[var(--ink-muted)]">No client tasks in this engagement yet.</p>}</Card><p className="mt-2 text-sm text-[var(--ink-muted)]">{openTasks.length} open client task{openTasks.length === 1 ? "" : "s"}</p></section>
    <section aria-labelledby="engagement-milestones"><h2 id="engagement-milestones" className="mb-3 font-[family-name:var(--font-display)] text-xl">Milestones and decisions</h2><p className="mb-3 text-sm text-[var(--ink-muted)]">Includes account-wide work shared with this engagement.</p><div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">{operations.milestones.map((milestone) => <article key={milestone.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-sm font-semibold">{milestone.title}</h3><Badge tone={milestone.status === "completed" ? "success" : "neutral"}>{statusLabel(milestone.status)}</Badge></div><p className="mt-1 text-sm text-[var(--ink-muted)]">{milestone.engagementId ? "This engagement" : "Account-wide"}{milestone.dueDate ? ` · Due ${formatDate(milestone.dueDate)}` : ""}</p></article>)}{operations.approvals.map((approval) => <Link key={approval.id} href={`/portal/approvals?engagementId=${encodeURIComponent(id)}`} className="flex min-h-16 items-center justify-between gap-3 py-3"><span className="min-w-0"><span className="block break-words text-sm font-semibold">{approval.subject}</span><span className="mt-1 block text-sm text-[var(--ink-muted)]">{approval.engagementId ? "This engagement" : "Account-wide"} · {statusLabel(approval.status)}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>)}{!operations.milestones.length && !operations.approvals.length ? <p className="py-4 text-sm text-[var(--ink-muted)]">No milestones or decisions in this engagement yet.</p> : null}</div></section>
    <nav aria-label="Resources for this engagement" className="flex flex-wrap gap-3 text-sm font-semibold text-[var(--brand)]"><Link href={`/portal/forms?engagementId=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]">Forms ({forms.length})</Link><Link href={`/portal/documents?engagementId=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]">Documents ({documents.length})</Link><Link href={`/portal/approvals?engagementId=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]">Approvals ({operations.approvals.length})</Link><Link href={`/portal/messages?engagementId=${encodeURIComponent(id)}`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 hover:bg-[var(--surface-2)]">Messages</Link></nav>
  </div>;
}
