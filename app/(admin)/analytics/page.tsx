"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime, statusLabel } from "@/lib/utils";
import type { ClientStatus, ClientWithProgress, Task } from "@/types";

type Analytics = {
  activeEngagements: number;
  avgOnboardingDays: number;
  clientsByStatus: Record<ClientStatus, number>;
  overdueTasks: number;
  totalClients: number;
  teamCount?: number;
  avgTasksCompleted?: number;
  documentsPendingReview?: number;
  funnel?: {
    invited: number;
    started: number;
    completed: number;
  };
  recentActivity?: Array<{
    id: string;
    clientId: string;
    clientName?: string;
    actorName: string;
    action: string;
    timestamp: string;
  }>;
  overdueTaskList?: Array<{
    taskId: string;
    title: string;
    clientId: string;
    clientName?: string;
    dueDate: string;
  }>;
};

type OverdueRow = {
  taskId: string;
  title: string;
  clientId: string;
  clientName: string;
  dueDate: string;
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "on_hold") return "danger";
  if (status === "not_started") return "warning";
  return "neutral";
}

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [overdueList, setOverdueList] = useState<OverdueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<Analytics>("/api/analytics", { token });
      setAnalytics(data);

      if (data.overdueTaskList && data.overdueTaskList.length) {
        setOverdueList(
          data.overdueTaskList.map((t) => ({
            taskId: t.taskId,
            title: t.title,
            clientId: t.clientId,
            clientName: t.clientName || "Client",
            dueDate: t.dueDate,
          }))
        );
      } else if (data.overdueTasks > 0) {
        // Build overdue list from clients/tasks when API only returns a count
        const clientsRes = await apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", {
          token,
        });
        const now = Date.now();
        const rows: OverdueRow[] = [];
        await Promise.all(
          clientsRes.clients.map(async (client) => {
            const tasksRes = await apiFetch<{ tasks: Task[] }>(
              `/api/tasks?clientId=${encodeURIComponent(client.id)}`,
              { token }
            );
            for (const task of tasksRes.tasks) {
              if (
                task.dueDate &&
                task.status !== "completed" &&
                new Date(task.dueDate).getTime() < now
              ) {
                rows.push({
                  taskId: task.id,
                  title: task.title,
                  clientId: client.id,
                  clientName: client.name,
                  dueDate: task.dueDate,
                });
              }
            }
          })
        );
        rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        setOverdueList(rows);
      } else {
        setOverdueList([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function runOverdueScan() {
    setScanning(true);
    setScanMessage("");
    setError("");
    try {
      const data = await apiFetch<{ count: number; sent: unknown[] }>("/api/notify", {
        method: "POST",
        token,
        body: JSON.stringify({ type: "overdue_scan" }),
      });
      setScanMessage(`Overdue scan complete — ${data.count} notification(s) sent.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Overdue scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function downloadCsv() {
    setDownloading(true);
    setError("");
    try {
      const res = await fetch("/api/analytics?format=csv", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "boatship-clients.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV download failed");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading analytics…</p>;
  }

  if (error && !analytics) {
    return (
      <EmptyState
        title="Couldn’t load analytics"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  const byStatus = analytics?.clientsByStatus;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Client engagements, onboarding health, overdue work, and recent activity."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void downloadCsv()}
              disabled={downloading}
            >
              {downloading ? "Downloading…" : "Download CSV"}
            </Button>
            <Button type="button" onClick={() => void runOverdueScan()} disabled={scanning}>
              {scanning ? "Scanning…" : "Run overdue notify scan"}
            </Button>
          </div>
        }
      />

      {scanMessage ? (
        <p className="mb-4 rounded-[var(--radius-sm)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          {scanMessage}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total clients" marker={1} value={analytics?.totalClients ?? 0} />
        <StatTile label="Active engagements" marker={2} value={analytics?.activeEngagements ?? 0} />
        <StatTile label="Overdue tasks" marker={4} value={analytics?.overdueTasks ?? 0} delta={analytics?.overdueTasks ? { value: "needs attention", direction: "down" } : { value: "nothing overdue", direction: "up" }} />
        <StatTile label="Approx. onboarding days" marker={3} value={analytics?.avgOnboardingDays ?? 0} />
        <StatTile label="Team members" marker={1} value={analytics?.teamCount ?? "—"} />
        <StatTile label="Avg tasks completed" marker={2} value={analytics?.avgTasksCompleted ?? 0} />
        <StatTile label="Docs pending review" marker={3} value={analytics?.documentsPendingReview ?? 0} />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Onboarding funnel</h2>
          <ul className="space-y-3">
            <li className="flex items-center justify-between text-sm">
              <span className="text-[var(--ink-muted)]">Invited</span>
              <span className="font-medium">{analytics?.funnel?.invited ?? 0}</span>
            </li>
            <li className="flex items-center justify-between text-sm">
              <span className="text-[var(--ink-muted)]">Started</span>
              <span className="font-medium">{analytics?.funnel?.started ?? 0}</span>
            </li>
            <li className="flex items-center justify-between text-sm">
              <span className="text-[var(--ink-muted)]">Completed</span>
              <span className="font-medium">{analytics?.funnel?.completed ?? 0}</span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-[var(--ink-muted)]">
            Invited = has a client portal user. Started = any in-progress or completed task.
          </p>
        </Card>

        <Card>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Clients by status</h2>
          <ul className="space-y-3">
            {(
              ["not_started", "in_progress", "completed", "on_hold"] as ClientStatus[]
            ).map((s) => (
              <li key={s} className="flex items-center justify-between text-sm">
                <Badge tone={statusTone(s)}>{statusLabel(s)}</Badge>
                <span className="font-medium">{byStatus?.[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Recent activity</h2>
          {!analytics?.recentActivity?.length ? (
            <p className="text-sm text-[var(--ink-muted)]">No recent activity.</p>
          ) : (
            <ul className="max-h-80 space-y-3 overflow-y-auto overscroll-contain">
              {analytics.recentActivity.slice(0, 15).map((entry) => (
                <li key={entry.id} className="text-sm">
                  <p>
                    <span className="font-medium">{entry.actorName}</span>{" "}
                    <span className="text-[var(--ink-muted)]">{entry.action}</span>
                    {entry.clientName ? (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          href={`/clients/${entry.clientId}`}
                          className="text-[var(--brand)] hover:underline"
                        >
                          {entry.clientName}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {formatDateTime(entry.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg">Overdue tasks</h2>
        </div>
        {overdueList.length === 0 ? (
          <div className="p-5">
            <p className="text-sm text-[var(--ink-muted)]">No overdue tasks right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Task</th>
                  <th className="hidden px-5 py-3 font-semibold sm:table-cell">Client</th>
                  <th className="px-5 py-3 font-semibold">Due</th>
                </tr>
              </thead>
              <tbody>
                {overdueList.map((row) => (
                  <tr key={row.taskId} className="border-t border-[var(--border)]">
                    <td className="px-5 py-3 font-medium">{row.title}</td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <Link
                        href={`/clients/${row.clientId}`}
                        className="text-[var(--brand)] hover:underline"
                      >
                        {row.clientName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[var(--ink-muted)]">
                      {formatDateTime(row.dueDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
