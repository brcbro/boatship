"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";
import type { ClientStatus, ClientWithProgress } from "@/types";

type Analytics = {
  totalClients: number;
  clientsByStatus: Record<ClientStatus, number>;
  overdueTasks: number;
  avgOnboardingDays: number;
  teamCount?: number;
  recentActivity?: Array<{
    id: string;
    clientId: string;
    clientName?: string;
    actorName: string;
    action: string;
    timestamp: string;
  }>;
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed" || status === "approved") return "success";
  if (status === "in_progress" || status === "pending_review" || status === "submitted") return "info";
  if (status === "on_hold" || status === "blocked" || status === "rejected") return "danger";
  if (status === "not_started" || status === "pending") return "warning";
  return "neutral";
}

export default function DashboardPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, c] = await Promise.all([
        apiFetch<Analytics>("/api/analytics", { token }),
        apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token }),
      ]);
      setAnalytics(a);
      setClients(
        [...c.clients].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, 8)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading dashboard…</p>;
  }

  if (error) {
    return (
      <EmptyState
        title="Couldn’t load dashboard"
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
        title="Dashboard"
        description="Onboarding overview across your clients."
        actions={
          <Link href="/clients/new">
            <Button type="button">New client</Button>
          </Link>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Total clients</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {analytics?.totalClients ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">By status</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                "not_started",
                "in_progress",
                "completed",
                "on_hold",
              ] as ClientStatus[]
            ).map((s) => (
              <Badge key={s} tone={statusTone(s)}>
                {statusLabel(s)}: {byStatus?.[s] ?? 0}
              </Badge>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Overdue tasks</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {analytics?.overdueTasks ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Avg onboarding days</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {analytics?.avgOnboardingDays ?? 0}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            Recent clients
          </h2>
          <Link href="/clients" className="text-sm text-[var(--accent)] hover:underline">
            View all
          </Link>
        </div>
        {clients.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No clients yet"
              description="Create your first client to start onboarding."
              action={
                <Link href="/clients/new">
                  <Button type="button">New client</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t border-[var(--border)] hover:bg-slate-50/80"
                    onClick={() => router.push(`/clients/${c.id}`)}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-[var(--ink)] hover:text-[var(--accent)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--ink-muted)]">{c.companyName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <ProgressBar value={c.progress} />
                        </div>
                        <span className="text-xs text-[var(--ink-muted)]">{c.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--ink-muted)]">{formatDate(c.updatedAt)}</td>
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
