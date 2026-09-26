"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import { Card, PageHeader } from "@/components/shared/ui";
import { TaskBoard } from "@/components/shared/TaskBoard";
import { apiFetch } from "@/lib/api-client";
import type { Task } from "@/types";

function PortalTasksPageInner() {
  const taskId = useSearchParams().get("taskId");
  const { session, token, loading: authLoading } = useAuth();
  const clientId = session?.clientId;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ tasks: Task[] }>(
        `/api/tasks?clientId=${encodeURIComponent(clientId)}`,
        { token }
      );
      setTasks(
        data.tasks
          .filter((t) => t.type === "client_facing")
          .sort((a, b) => a.order - b.order)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title="Tasks" description="Loading your checklist…" />
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </Card>
      </div>
    );
  }

  if (!session?.clientId) {
    return (
      <div>
        <PageHeader title="Tasks" />
        <Card><h2 className="text-lg font-semibold text-[var(--ink)]">Your account needs a client workspace</h2><p className="mt-2 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">Ask your Boatship workspace administrator to connect your account. Share your sign-in email: <span className="font-medium text-[var(--ink)]">{session?.email || "the email you used to sign in"}</span>.</p></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Work through your onboarding checklist one step at a time. Open a task to see its details, subtasks, and messages from your team."
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <TaskBoard mode="client" tasks={tasks} busy={busy} onUpdate={updateTask} initialOpenTaskId={taskId} />
    </div>
  );
}

export default function PortalTasksPage() {
  return <Suspense fallback={<div><PageHeader title="Tasks" description="Loading your checklist…" /><Card className="text-sm text-[var(--ink-muted)]">Loading tasks…</Card></div>}><PortalTasksPageInner /></Suspense>;
}
