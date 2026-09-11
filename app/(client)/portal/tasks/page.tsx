"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { TaskBoard } from "@/components/shared/TaskBoard";
import { apiFetch } from "@/lib/api-client";
import type { Task } from "@/types";

export default function PortalTasksPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
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
      const data = await apiFetch<{ tasks: Task[] }>(
        `/api/tasks?clientId=${encodeURIComponent(session.clientId)}`,
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
        <EmptyState
          title="No client linked"
          description="No client account is linked to this user."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Compact sections — click any row to open details, subtasks, and comments."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <TaskBoard mode="client" tasks={tasks} busy={busy} onUpdate={updateTask} />
    </div>
  );
}
