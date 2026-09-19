"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, FileText, MessageCircle } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
} from "@/components/shared/ui";
import { TaskBoard } from "@/components/shared/TaskBoard";
import { apiFetch } from "@/lib/api-client";
import { statusLabel } from "@/lib/utils";
import type { ClientWithProgress, FormSubmission, Task } from "@/types";

function clientStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "on_hold") return "warning";
  return "neutral";
}

function formatEta(days: number) {
  if (days <= 0) return "Complete";
  if (days === 1) return "~1 day remaining";
  return `~${days} days remaining`;
}

export default function PortalDashboardPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [client, setClient] = useState<ClientWithProgress | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session?.clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const clientId = session.clientId;
      const [clientRes, tasksRes, formsRes] = await Promise.all([
        apiFetch<{ client: ClientWithProgress }>(`/api/clients/${clientId}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(clientId)}`, {
          token,
        }),
        apiFetch<{ forms: FormSubmission[] }>(
          `/api/forms?clientId=${encodeURIComponent(clientId)}`,
          { token }
        ),
      ]);
      setClient(clientRes.client);
      setTasks(
        tasksRes.tasks
          .filter((t) => t.type === "client_facing")
          .sort((a, b) => a.order - b.order)
      );
      setForms(formsRes.forms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [session?.clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  async function updateTask(taskId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ task: Task }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
      if (session?.clientId) {
        const c = await apiFetch<{ client: ClientWithProgress }>(
          `/api/clients/${session.clientId}`,
          { token }
        );
        setClient(c.client);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setBusy(false);
    }
  }

  const incompleteTasks = useMemo(
    () => tasks.filter((t) => t.status !== "completed"),
    [tasks]
  );
  const nextTasks = incompleteTasks.slice(0, 5);
  const remainingCount = incompleteTasks.length;
  const etaDays = remainingCount * 2;
  const progressPct = client
    ? Math.max(0, Math.min(100, Math.round(client.progress)))
    : 0;

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Loading your onboarding progress…" />
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </Card>
      </div>
    );
  }

  if (!session?.clientId || error) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Unable to load portal"
          description={error || "No client account is linked to this user."}
        />
      </div>
    );
  }

  if (!client) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <EmptyState title="Client not found" description="Your client record could not be loaded." />
      </div>
    );
  }

  const incompleteForms = forms.filter((f) => f.status === "not_started").length;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${client.name}`}
        description={`${client.companyName} · Here’s the clearest next step for your onboarding.`}
      />

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.55fr)]">
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div className="absolute right-0 top-0 h-28 w-28 -translate-y-1/3 translate-x-1/3 rounded-full bg-[var(--accent-soft)]" aria-hidden="true" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">Your onboarding progress</p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-5xl leading-none tracking-[-0.04em] text-[var(--brand)] tabular-nums">{progressPct}%</p>
              </div>
              <Badge tone={clientStatusTone(client.status)}>{statusLabel(client.status)}</Badge>
            </div>
            <ProgressBar value={progressPct} />
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">{client.completedTasks} of {client.totalTasks}</span> tasks complete</p>
              <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-[var(--ink-muted)]"><span className="font-semibold text-[var(--ink)]">{formatEta(etaDays)}</span>{incompleteForms ? ` · ${incompleteForms} form${incompleteForms === 1 ? "" : "s"} waiting` : ""}</p>
            </div>
          </div>
        </Card>
        <Card className="flex flex-col justify-between p-5 sm:p-6">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">Need a hand?</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Your onboarding team can help with questions, files, or decisions.</p>
          </div>
          <Link href="/portal/messages" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)]">
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> Message your team
          </Link>
        </Card>
      </section>

      <section className="mb-8 grid gap-3 sm:grid-cols-3" aria-label="Workspace shortcuts">
        <PortalShortcut href="/portal/tasks" title="Tasks" detail={remainingCount ? `${remainingCount} remaining` : "All caught up"} icon={ClipboardCheck} />
        <PortalShortcut href="/portal/forms" title="Forms" detail={incompleteForms ? `${incompleteForms} to complete` : "View submitted forms"} icon={FileText} />
        <PortalShortcut href="/portal/documents" title="Documents" detail="Upload or review files" icon={FileText} />
      </section>

      {nextTasks.length > 0 ? (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Up next</p>
              <p className="text-xs text-[var(--ink-muted)]">
                Your next incomplete onboarding tasks
              </p>
            </div>
            <Link href="/portal/tasks" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[var(--brand)] hover:underline">
              View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {nextTasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{task.title}</p>
                  <p className="text-xs text-[var(--ink-muted)]">{statusLabel(task.status)}</p>
                </div>
                <Badge
                  tone={
                    task.status === "blocked"
                      ? "danger"
                      : task.status === "in_progress"
                        ? "info"
                        : "neutral"
                  }
                >
                  {statusLabel(task.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="mb-6">
          <p className="text-sm font-medium text-[var(--ink)]">You&apos;re all caught up</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            No incomplete client tasks remain.
          </p>
        </Card>
      )}

      <section aria-label="All onboarding tasks">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">All tasks</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Open a task for its requirements, subtasks, and team comments.</p></div>
        </div>
        <TaskBoard mode="client" tasks={tasks} busy={busy} onUpdate={updateTask} />
      </section>
    </div>
  );
}

function PortalShortcut({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof FileText }) {
  return <Link href={href} className="group flex min-h-24 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--ink-muted)]/45 hover:shadow-[0_12px_28px_rgba(20,43,53,0.08)]">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--ink)]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <span className="min-w-0"><span className="block text-sm font-semibold text-[var(--ink)]">{title}</span><span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{detail}</span></span>
    <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[var(--ink-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" aria-hidden="true" />
  </Link>;
}
