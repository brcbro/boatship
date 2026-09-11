"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
        description={`${client.companyName} · click a task to open details.`}
      />

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Onboarding progress</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--brand)]">
              {progressPct}%
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {client.completedTasks} of {client.totalTasks} tasks complete
              {incompleteForms ? ` · ${incompleteForms} form(s) waiting` : ""}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Estimated time left: {formatEta(etaDays)}
              {remainingCount > 0 ? ` (${remainingCount} task${remainingCount === 1 ? "" : "s"} × ~2 days)` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={clientStatusTone(client.status)}>{statusLabel(client.status)}</Badge>
            <Link
              href="/portal/messages"
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              Messages →
            </Link>
          </div>
        </div>
        <ProgressBar value={progressPct} />
      </Card>

      {nextTasks.length > 0 ? (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Up next</p>
              <p className="text-xs text-[var(--ink-muted)]">
                Your next incomplete onboarding tasks
              </p>
            </div>
            <Link
              href="/portal/tasks"
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              View all tasks
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

      <TaskBoard mode="client" tasks={tasks} busy={busy} onUpdate={updateTask} />
    </div>
  );
}
