"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { ClientWithProgress, Task } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };

type WorkloadRow = {
  uid: string;
  name: string;
  email: string;
  role: string;
  openCount: number;
  urgentCount: number;
  overdueCount: number;
};

export default function WorkloadPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersData, clientsData] = await Promise.all([
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token }),
      ]);
      setUsers(usersData.users);

      const taskResults = await Promise.all(
        clientsData.clients.map((client) =>
          apiFetch<{ tasks: Task[] }>(
            `/api/tasks?clientId=${encodeURIComponent(client.id)}`,
            { token }
          )
        )
      );
      setTasks(taskResults.flatMap((r) => r.tasks));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workload");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();

  const rows = useMemo(() => {
    const openTasks = tasks.filter((t) => t.status !== "completed");
    const byAssignee = new Map<string, Task[]>();
    for (const task of openTasks) {
      if (!task.assignedTo) continue;
      const list = byAssignee.get(task.assignedTo) || [];
      list.push(task);
      byAssignee.set(task.assignedTo, list);
    }

    const result: WorkloadRow[] = users.map((u) => {
      const assigned = byAssignee.get(u.uid) || [];
      return {
        uid: u.uid,
        name: u.name,
        email: u.email,
        role: u.role,
        openCount: assigned.length,
        urgentCount: assigned.filter(
          (t) => t.priority === "urgent" || t.priority === "high"
        ).length,
        overdueCount: assigned.filter(
          (t) => t.dueDate && new Date(t.dueDate).getTime() < now
        ).length,
      };
    });

    return result.sort((a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name));
  }, [users, tasks, now]);

  const unassignedOpen = useMemo(
    () => tasks.filter((t) => t.status !== "completed" && !t.assignedTo).length,
    [tasks]
  );

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading workload…</p>;
  }

  if (error && users.length === 0) {
    return <EmptyState title="Couldn’t load workload" description={error} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workload"
        description="Open tasks assigned to each team member."
      />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-sm text-[var(--ink-muted)]">
        <span>
          Team members: <strong className="text-[var(--ink)]">{users.length}</strong>
        </span>
        <span>·</span>
        <span>
          Open tasks:{" "}
          <strong className="text-[var(--ink)]">
            {tasks.filter((t) => t.status !== "completed").length}
          </strong>
        </span>
        <span>·</span>
        <span>
          Unassigned open: <strong className="text-[var(--ink)]">{unassignedOpen}</strong>
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No team members" description="Invite staff from the Team page." />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.uid}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{row.name}</p>
                  <p className="truncate text-sm text-[var(--ink-muted)]">
                    {row.email} · {row.role}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.openCount > 0 ? "info" : "neutral"}>
                    {row.openCount} open
                  </Badge>
                  {row.urgentCount > 0 ? (
                    <Badge tone="warning">{row.urgentCount} high/urgent</Badge>
                  ) : null}
                  {row.overdueCount > 0 ? (
                    <Badge tone="danger">{row.overdueCount} overdue</Badge>
                  ) : null}
                  <Link
                    href="/clients"
                    className="text-sm font-medium text-[var(--brand)] hover:underline"
                  >
                    View clients
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
