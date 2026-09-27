"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Card, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";
import type { Task } from "@/types";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId || !id) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const [detail, taskList] = await Promise.all([
        apiFetch<{ engagement: Engagement }>(`/api/engagements/${encodeURIComponent(id)}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(clientId)}&engagementId=${encodeURIComponent(id)}`, { token }),
      ]);
      setEngagement(detail.engagement);
      setTasks(taskList.tasks.filter((task) => task.type === "client_facing").sort((a, b) => a.order - b.order));
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
    <section aria-label="Engagement summary" className="grid gap-4 sm:grid-cols-3">
      <Card><p className="text-sm text-[var(--ink-muted)]">Status</p><p className="mt-2 text-lg font-semibold text-[var(--ink)]">{statusLabel(engagement.status)}</p></Card>
      <Card><p className="text-sm text-[var(--ink-muted)]">Your tasks complete</p><p className="mt-2 text-lg font-semibold tabular-nums text-[var(--ink)]">{completedTasks} of {tasks.length}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{engagement.progress}% of your tasks complete</p></Card>
      <Card><p className="text-sm text-[var(--ink-muted)]">Timeline</p><p className="mt-2 text-sm font-medium text-[var(--ink)]">{engagement.completedAt ? `Finished ${formatDate(engagement.completedAt)}` : engagement.targetDate ? `Target ${formatDate(engagement.targetDate)}` : engagement.startDate ? `Started ${formatDate(engagement.startDate)}` : "Dates to be confirmed"}</p></Card>
    </section>
    <section aria-labelledby="engagement-tasks"><div className="mb-3 flex items-center justify-between gap-3"><h2 id="engagement-tasks" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Your tasks</h2><Link href="/portal/tasks" className="text-sm font-semibold text-[var(--brand)] hover:underline">All tasks</Link></div><Card className="divide-y divide-[var(--border)] p-0">{tasks.length ? tasks.map((task) => <Link key={task.id} href={`/portal/tasks?taskId=${encodeURIComponent(task.id)}`} className="flex min-h-16 items-center justify-between gap-3 px-5 py-3 transition hover:bg-[var(--surface-2)]"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{task.title}</span><span className="mt-1 block text-xs text-[var(--ink-muted)]">{task.dueDate ? `Due ${formatDate(task.dueDate)} · ` : ""}{statusLabel(task.status)}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden="true" /></Link>) : <p className="px-5 py-5 text-sm text-[var(--ink-muted)]">No client tasks in this engagement yet.</p>}</Card><p className="mt-2 text-sm text-[var(--ink-muted)]">{openTasks.length} open client task{openTasks.length === 1 ? "" : "s"}</p></section>
    <nav aria-label="Other workspace sections" className="flex flex-wrap gap-4 text-sm font-semibold text-[var(--brand)]"><Link href="/portal/forms" className="min-h-10 hover:underline">Forms</Link><Link href="/portal/documents" className="min-h-10 hover:underline">Documents</Link><Link href="/portal/approvals" className="min-h-10 hover:underline">Approvals</Link><Link href="/portal/messages" className="min-h-10 hover:underline">Messages</Link></nav>
  </div>;
}
