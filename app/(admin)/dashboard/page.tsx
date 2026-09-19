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

type OnboardingHealth = {
  clientId: string;
  state: "on_track" | "waiting_on_client" | "blocked_internally" | "ready_to_launch";
  score: number;
  blockers: unknown[];
};

const healthLabels: Record<OnboardingHealth["state"], string> = {
  on_track: "On track",
  waiting_on_client: "Waiting on client",
  blocked_internally: "Blocked internally",
  ready_to_launch: "Ready to launch",
};

function healthTone(state: OnboardingHealth["state"]): "success" | "warning" | "danger" | "info" {
  if (state === "ready_to_launch") return "success";
  if (state === "waiting_on_client") return "warning";
  if (state === "blocked_internally") return "danger";
  return "info";
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed" || status === "approved") return "success";
  if (status === "in_progress" || status === "pending_review" || status === "submitted") return "info";
  if (status === "on_hold" || status === "blocked" || status === "rejected") return "danger";
  if (status === "not_started" || status === "pending") return "warning";
  return "neutral";
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [healthByClientId, setHealthByClientId] = useState<Record<string, OnboardingHealth>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{
        analytics: Analytics;
        clients: ClientWithProgress[];
        health: OnboardingHealth[];
      }>("/api/dashboard", { token });
      setAnalytics(data.analytics);
      setClients(data.clients);
      setHealthByClientId(
        Object.fromEntries(data.health.map((item) => [item.clientId, item]))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
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
            <table className="w-full min-w-0 text-left text-sm sm:min-w-[640px]">
              <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Onboarding health</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[var(--border)] hover:bg-slate-50/80"
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
                    <td className="hidden px-4 py-2.5 text-[var(--ink-muted)] sm:table-cell">{c.companyName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      {healthByClientId[c.id] ? (
                        <div className="flex items-center gap-2">
                          <Badge tone={healthTone(healthByClientId[c.id].state)}>
                            {healthLabels[healthByClientId[c.id].state]}
                          </Badge>
                          <span className="text-xs text-[var(--ink-muted)]">
                            {healthByClientId[c.id].blockers.length} blocker{healthByClientId[c.id].blockers.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <ProgressBar value={c.progress} />
                        </div>
                        <span className="text-xs text-[var(--ink-muted)]">{c.progress}%</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-[var(--ink-muted)] sm:table-cell">{formatDate(c.updatedAt)}</td>
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
