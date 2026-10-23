"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ClipboardCheck, FileText, MessageCircle, ThumbsUp } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, ButtonLink, Card, PageHeader, ProgressBar, SectionHeading } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";
import type { ClientWithProgress, FormSubmission, Task } from "@/types";

type ApprovalSummary = { id: string; subject: string; status: string };
type EngagementSummary = { id: string; name: string; type: string; status: string; targetDate: string | null; taskCount: number; completedTaskCount: number; progress: number };

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
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const encodedClientId = encodeURIComponent(clientId);
      const [clientRes, tasksRes, formsRes, approvalsRes, engagementsRes] = await Promise.all([
        apiFetch<{ client: ClientWithProgress }>(`/api/clients/${encodedClientId}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodedClientId}`, { token }),
        apiFetch<{ forms: FormSubmission[] }>(`/api/forms?clientId=${encodedClientId}`, { token }),
        apiFetch<{ approvals: ApprovalSummary[] }>(`/api/project-operations?clientId=${encodedClientId}`, { token }),
        apiFetch<{ engagements: EngagementSummary[] }>(`/api/clients/${encodedClientId}/engagements`, { token }),
      ]);
      setClient(clientRes.client);
      setTasks(tasksRes.tasks.filter((task) => task.type === "client_facing").sort((a, b) => a.order - b.order));
      setForms(formsRes.forms);
      setApprovals(approvalsRes.approvals);
      setEngagements(engagementsRes.engagements);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load your workspace.");
    } finally { setLoading(false); }
  }, [clientId, token]);

  useEffect(() => { if (authLoading) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [authLoading, load]);

  const currentEngagements = engagements.filter((item) => item.status !== "completed" && item.status !== "cancelled");
  const actionableIds = new Set(currentEngagements.filter((item) => item.status !== "paused").map((item) => item.id));
  const openTasks = tasks.filter((task) => task.status !== "completed" && (!task.engagementId || actionableIds.has(task.engagementId))).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.order - b.order);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const incompleteForms = forms.filter((form) => form.status === "not_started").length;
  const nextTask = openTasks.find((task) => task.status !== "blocked") || openTasks[0];
  const completedTasks = tasks.filter((task) => task.status === "completed").length;
  const waitingCount = pendingApprovals.length + openTasks.length + incompleteForms;
  const firstName = (client?.name || "").trim().split(/\s+/)[0] || "there";

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title="Your workspace" description="Loading your next steps…" />
        <Card className="animate-pulse"><div className="h-6 w-48 rounded bg-[var(--surface-2)]" /><div className="mt-4 h-14 rounded bg-[var(--surface-2)]" /></Card>
      </div>
    );
  }

  if (!session?.clientId) {
    return (
      <div>
        <PageHeader title="Your workspace" />
        <Card>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Your account needs a client workspace</h2>
          <p className="mt-2 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">Ask your Boatship workspace administrator to connect your account. Share your sign-in email so they can find the right user: <span className="font-medium text-[var(--ink)]">{session?.email}</span></p>
        </Card>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div>
        <PageHeader title="Your workspace" />
        <Card>
          <h2 className="text-lg font-semibold text-[var(--ink)]">We couldn’t load your workspace</h2>
          <p role="alert" className="mt-2 text-sm text-[var(--ink-muted)]">{error || "Your client record could not be loaded."}</p>
          <Button type="button" className="mt-4" onClick={() => void load()}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={client.companyName} title={`Hello, ${firstName}`} description={waitingCount === 0 ? "Nothing is waiting on you right now." : `${waitingCount} thing${waitingCount === 1 ? "" : "s"} need${waitingCount === 1 ? "s" : ""} you this week.`} />

      <section aria-labelledby="next-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.5fr)]">
        <div className="relative overflow-hidden rounded-[var(--radius-xl)] bg-[var(--accent)] p-6 text-[var(--on-accent)] sm:p-8">
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border-[22px] border-[var(--on-accent)]/10" />
          <p id="next-heading" className="text-xs font-bold uppercase tracking-[0.12em] opacity-80">Your next step</p>
          {pendingApprovals.length > 0 ? (
            <>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[2.1rem]">{pendingApprovals[0].subject}</p>
              <p className="mt-2 text-sm opacity-85">A decision is waiting · {pendingApprovals.length} approval{pendingApprovals.length === 1 ? "" : "s"} to review</p>
              <Link href="/portal/approvals" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--on-accent)] px-4 text-sm font-semibold text-[var(--accent)] transition-transform hover:translate-x-0.5">Review approval <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </>
          ) : nextTask ? (
            <>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[2.1rem]">{nextTask.title}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm opacity-85">
                {nextTask.engagementId ? <span>{engagements.find((item) => item.id === nextTask.engagementId)?.name}</span> : null}
                {nextTask.dueDate ? <span>· Due {formatDate(nextTask.dueDate)}</span> : null}
                <Badge tone={taskTone(nextTask.status)} className="bg-[var(--on-accent)]/15 text-[var(--on-accent)]">{statusLabel(nextTask.status)}</Badge>
              </p>
              {nextTask.description ? <p className="mt-3 max-w-prose text-sm leading-6 opacity-90">{nextTask.description}</p> : null}
              <Link href={`/portal/tasks?taskId=${encodeURIComponent(nextTask.id)}`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--on-accent)] px-4 text-sm font-semibold text-[var(--accent)] transition-transform hover:translate-x-0.5">Open task <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </>
          ) : (
            <>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[2.1rem]">You’re all caught up</p>
              <p className="mt-2 text-sm opacity-85">There are no tasks or decisions waiting for you. Your team will let you know when something changes.</p>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Your progress</h2>
            <p className="mt-2 font-[family-name:var(--font-display)] text-[2rem] font-bold leading-none tabular-nums text-[var(--ink)]">{completedTasks}<span className="text-base font-semibold text-[var(--ink-muted)]"> / {tasks.length}</span></p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">tasks complete{incompleteForms ? ` · ${incompleteForms} form${incompleteForms === 1 ? "" : "s"} to finish` : ""}</p>
            <div className="mt-3"><ProgressBar value={tasks.length ? (completedTasks / tasks.length) * 100 : 0} label="Tasks complete" tone="success" /></div>
          </Card>
          <Card className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Need a hand?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Ask your delivery team about a task, a file or a decision.</p>
            <ButtonLink href="/portal/messages" variant="secondary" size="sm" className="mt-3"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Message the team</ButtonLink>
          </Card>
        </div>
      </section>

      <section aria-labelledby="engagements-heading">
        <SectionHeading id="engagements-heading" title="Current engagements" action={<Link href="/portal/engagements" className="text-sm font-semibold text-[var(--brand)] hover:underline">All and history</Link>} />
        <div className="grid gap-3 sm:grid-cols-2">
          {currentEngagements.length ? currentEngagements.map((item) => (
            <Link key={item.id} href={`/portal/engagements/${encodeURIComponent(item.id)}`} className="group rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--brand)]">
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">{item.name}</span>
                  <span className="mt-1 block text-xs text-[var(--ink-muted)]">{statusLabel(item.status)}{item.targetDate ? ` · Target ${formatDate(item.targetDate)}` : ""}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ink-faint)] transition-colors group-hover:text-[var(--brand)]" aria-hidden="true" />
              </span>
              <span className="mt-4 block"><ProgressBar value={item.progress} label={`${item.name} progress`} /></span>
              <span className="mt-2 block text-xs tabular-nums text-[var(--ink-muted)]">{item.completedTaskCount} of {item.taskCount} tasks · {item.progress}%</span>
            </Link>
          )) : <Card className="text-sm text-[var(--ink-muted)]">No current engagements right now.</Card>}
        </div>
      </section>

      {openTasks.length > 1 ? (
        <section aria-labelledby="upcoming-heading">
          <SectionHeading id="upcoming-heading" title="Also open" action={<Link href="/portal/tasks" className="text-sm font-semibold text-[var(--brand)] hover:underline">All tasks</Link>} />
          <div className="divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] px-4">
            {openTasks.filter((task) => task.id !== nextTask?.id).slice(0, 4).map((task) => (
              <Link key={task.id} href={`/portal/tasks?taskId=${encodeURIComponent(task.id)}`} className="flex min-h-14 items-center justify-between gap-3 py-3 text-[var(--ink)] hover:text-[var(--brand)]">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{task.title}</span>
                  <span className="block text-xs text-[var(--ink-muted)]">{task.dueDate ? `Due ${formatDate(task.dueDate)}` : statusLabel(task.status)}</span>
                </span>
                <Badge tone={taskTone(task.status)}>{statusLabel(task.status)}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <nav aria-label="Workspace sections" className="grid gap-3 sm:grid-cols-3">
        <PortalShortcut href="/portal/forms" title="Forms" detail={incompleteForms ? `${incompleteForms} to complete` : "View your forms"} icon={ClipboardCheck} />
        <PortalShortcut href="/portal/documents" title="Documents" detail="Requested files and uploads" icon={FileText} />
        <PortalShortcut href="/portal/approvals" title="Approvals" detail={pendingApprovals.length ? `${pendingApprovals.length} waiting` : "Decisions you have made"} icon={ThumbsUp} />
      </nav>
    </div>
  );
}

function PortalShortcut({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof FileText }) {
  return (
    <Link href={href} className="group flex min-h-[4.5rem] items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition-colors hover:border-[var(--brand)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[var(--brand)]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{detail}</span>
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[var(--ink-faint)] transition-colors group-hover:text-[var(--brand)]" aria-hidden="true" />
    </Link>
  );
}
