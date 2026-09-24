"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, FileText, MessageCircle } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";
import type { ClientWithProgress, FormSubmission, Task } from "@/types";

type ApprovalSummary = { id: string; subject: string; status: string };

function taskTone(status: string): "neutral" | "info" | "danger" {
  if (status === "blocked") return "danger";
  if (status === "in_progress") return "info";
  return "neutral";
}

export default function PortalDashboardPage() {
  const { session, token, loading: authLoading } = useAuth();
  const clientId = session?.clientId;
  const [client, setClient] = useState<ClientWithProgress | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const encodedClientId = encodeURIComponent(clientId);
      const [clientRes, tasksRes, formsRes, approvalsRes] = await Promise.all([
        apiFetch<{ client: ClientWithProgress }>(`/api/clients/${encodedClientId}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodedClientId}`, { token }),
        apiFetch<{ forms: FormSubmission[] }>(`/api/forms?clientId=${encodedClientId}`, { token }),
        apiFetch<{ approvals: ApprovalSummary[] }>(`/api/project-operations?clientId=${encodedClientId}`, { token }),
      ]);
      setClient(clientRes.client);
      setTasks(tasksRes.tasks.filter((task) => task.type === "client_facing").sort((a, b) => a.order - b.order));
      setForms(formsRes.forms);
      setApprovals(approvalsRes.approvals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load your workspace.");
    } finally { setLoading(false); }
  }, [clientId, token]);

  useEffect(() => { if (authLoading) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [authLoading, load]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status !== "completed"), [tasks]);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const incompleteForms = forms.filter((form) => form.status === "not_started").length;
  const nextTask = openTasks.find((task) => task.status !== "blocked") || openTasks[0];
  const completedTasks = tasks.length - openTasks.length;

  if (authLoading || loading) return <div><PageHeader title="Your workspace" description="Loading your next steps…" /><Card className="animate-pulse"><div className="h-6 w-48 rounded bg-[var(--surface-2)]" /><div className="mt-4 h-14 rounded bg-[var(--surface-2)]" /></Card></div>;

  if (!session?.clientId) return <div><PageHeader title="Your workspace" /><Card><h2 className="text-lg font-semibold text-[var(--ink)]">Your account needs a client workspace</h2><p className="mt-2 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">Ask your Boatship workspace administrator to connect your account. Share your sign-in email so they can find the right user: <span className="font-medium text-[var(--ink)]">{session?.email || "the email you used to sign in"}</span>.</p></Card></div>;

  if (error || !client) return <div><PageHeader title="Your workspace" /><Card><h2 className="text-lg font-semibold text-[var(--ink)]">We couldn’t load your workspace</h2><p role="alert" className="mt-2 text-sm text-[var(--ink-muted)]">{error || "Your client record could not be loaded."}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">Try again</button></Card></div>;

  return (
    <div className="space-y-8">
      <PageHeader title={`Welcome, ${client.name}`} description={`${client.companyName} · Your onboarding workspace`} />
      <section aria-labelledby="next-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.6fr)]">
        <Card className="p-5 sm:p-7">
          <h2 id="next-heading" className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">What needs you next</h2>
          {pendingApprovals.length > 0 ? (
            <div className="mt-5 border-t border-[var(--border)] pt-5">
              <p className="text-sm font-medium text-[var(--ink-muted)]">Decision waiting</p>
              <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{pendingApprovals[0].subject}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{pendingApprovals.length} approval{pendingApprovals.length === 1 ? "" : "s"} to review</p>
              <Link href="/portal/approvals" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]">Review approval <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          ) : nextTask ? (
            <div className="mt-5 border-t border-[var(--border)] pt-5">
              <div className="flex flex-wrap items-center gap-2"><p className="text-lg font-semibold text-[var(--ink)]">{nextTask.title}</p><Badge tone={taskTone(nextTask.status)}>{statusLabel(nextTask.status)}</Badge></div>
              {nextTask.description ? <p className="mt-2 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">{nextTask.description}</p> : null}
              {nextTask.dueDate ? <p className="mt-2 text-sm text-[var(--ink-muted)]">Due {formatDate(nextTask.dueDate)}</p> : null}
              <Link href={`/portal/tasks?taskId=${encodeURIComponent(nextTask.id)}`} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-strong)]">Open task <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </div>
          ) : (
            <div className="mt-5 border-t border-[var(--border)] pt-5"><p className="text-lg font-semibold text-[var(--ink)]">You’re all caught up</p><p className="mt-1 text-sm text-[var(--ink-muted)]">There are no client tasks or decisions waiting for you.</p></div>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5 sm:p-6"><h2 className="text-sm font-semibold text-[var(--ink)]">Checklist</h2><p className="mt-2 font-[family-name:var(--font-display)] text-3xl tabular-nums text-[var(--ink)]">{completedTasks} <span className="text-lg text-[var(--ink-muted)]">of {tasks.length}</span></p><p className="mt-1 text-sm text-[var(--ink-muted)]">Client tasks complete{incompleteForms ? ` · ${incompleteForms} form${incompleteForms === 1 ? "" : "s"} to finish` : ""}</p><Link href="/portal/tasks" className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--brand)] hover:underline">View checklist <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Card>
          <Card className="p-5 sm:p-6"><h2 className="text-sm font-semibold text-[var(--ink)]">Need help?</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Ask your delivery team about tasks, files, or decisions.</p><Link href="/portal/messages" className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--brand)] hover:underline"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Message your team</Link></Card>
        </div>
      </section>
      {openTasks.length > 1 ? <section aria-labelledby="upcoming-heading"><div className="mb-3 flex items-end justify-between gap-3"><h2 id="upcoming-heading" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Other open tasks</h2><Link href="/portal/tasks" className="text-sm font-semibold text-[var(--brand)] hover:underline">View all</Link></div><div className="divide-y divide-[var(--border)] rounded-xl bg-[var(--surface-raised)] px-4">{openTasks.filter((task) => task.id !== nextTask?.id).slice(0, 3).map((task) => <Link key={task.id} href={`/portal/tasks?taskId=${encodeURIComponent(task.id)}`} className="flex min-h-14 items-center justify-between gap-3 py-3 hover:text-[var(--brand)]"><span className="min-w-0"><span className="block truncate text-sm font-medium">{task.title}</span><span className="block text-xs text-[var(--ink-muted)]">{task.dueDate ? `Due ${formatDate(task.dueDate)}` : statusLabel(task.status)}</span></span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>)}</div></section> : null}
      <nav aria-label="Workspace sections" className="grid gap-3 sm:grid-cols-3">
        <PortalShortcut href="/portal/forms" title="Forms" detail={incompleteForms ? `${incompleteForms} to complete` : "View your forms"} icon={ClipboardCheck} />
        <PortalShortcut href="/portal/documents" title="Documents" detail="See requested files and uploads" icon={FileText} />
        <PortalShortcut href="/portal/messages" title="Messages" detail="Talk with your team" icon={MessageCircle} />
      </nav>
    </div>
  );
}

function PortalShortcut({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof FileText }) {
  return <Link href={href} className="group flex min-h-20 items-center gap-3 rounded-xl bg-[var(--surface-raised)] p-4 transition hover:bg-[var(--surface-2)]"><Icon className="h-5 w-5 shrink-0 text-[var(--brand)]" aria-hidden="true" /><span className="min-w-0"><span className="block text-sm font-semibold text-[var(--ink)]">{title}</span><span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{detail}</span></span><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[var(--ink-muted)] transition group-hover:translate-x-0.5" aria-hidden="true" /></Link>;
}
