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
import type { ProductSummary } from "@/types/product";

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
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productsError, setProductsError] = useState("");
  const [healthByClientId, setHealthByClientId] = useState<Record<string, OnboardingHealth>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setProductsError("");
    try {
      const dashboardRequest = apiFetch<{
        analytics: Analytics;
        clients: ClientWithProgress[];
        health: OnboardingHealth[];
      }>("/api/dashboard", { token });
      const productsRequest = apiFetch<{ products: ProductSummary[] }>(
        "/api/products",
        { token }
      );
      const [data, productResult] = await Promise.all([
        dashboardRequest,
        productsRequest.then(
          (value) => ({ ok: true as const, value }),
          (reason: unknown) => ({ ok: false as const, reason })
        ),
      ]);
      setAnalytics(data.analytics);
      setClients(data.clients);
      setHealthByClientId(
        Object.fromEntries(data.health.map((item) => [item.clientId, item]))
      );
      if (productResult.ok) {
        setProducts(productResult.value.products);
      } else {
        setProducts([]);
        setProductsError("Product summary is unavailable right now.");
      }
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
    return <div role="status" aria-label="Loading dashboard" className="animate-pulse space-y-6">
      <div className="space-y-2"><div className="h-9 w-36 rounded bg-[var(--surface-2)]" /><div className="h-4 w-72 max-w-full rounded bg-[var(--surface-2)]" /></div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"><div className="h-6 w-44 rounded bg-[var(--surface-2)]" /><div className="mt-5 space-y-3"><div className="h-12 rounded bg-[var(--surface-2)]" /><div className="h-12 rounded bg-[var(--surface-2)]" /></div></div>
      <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 rounded-xl bg-[var(--surface-2)]" />)}</div>
    </div>;
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
  const needsAttention = clients.filter((client) => {
    const health = healthByClientId[client.id];
    return health?.state === "blocked_internally" || health?.state === "waiting_on_client" || client.status === "on_hold";
  });

  return (
    <div>
      <PageHeader
        title="Today"
        description="Client work that needs a decision or follow-up."
        actions={
          <Link href="/clients/new">
            <Button type="button">New client</Button>
          </Link>
        }
      />

      <section aria-labelledby="attention-heading" className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="attention-heading" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Needs attention</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Review stalled clients and overdue work before the rest of the portfolio.</p>
          </div>
          <Link href="/workload" className="text-sm font-medium text-[var(--accent)] hover:underline">View workload</Link>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="space-y-2">
            {needsAttention.length ? needsAttention.slice(0, 5).map((client) => (
              <Link key={client.id} href={`/clients/${client.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-4 py-3 transition hover:bg-slate-100">
                <span className="font-medium text-[var(--ink)]">{client.companyName || client.name}</span>
                <Badge tone={healthByClientId[client.id] ? healthTone(healthByClientId[client.id].state) : "danger"}>
                  {healthByClientId[client.id] ? healthLabels[healthByClientId[client.id].state] : statusLabel(client.status)}
                </Badge>
              </Link>
            )) : <p className="rounded-lg bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-muted)]">No clients are currently marked as blocked or waiting.</p>}
            {needsAttention.length > 5 ? <Link href="/clients" className="inline-block pt-1 text-sm font-medium text-[var(--accent)] hover:underline">View all {needsAttention.length} clients</Link> : null}
          </div>
          <Link href="/workload" className="rounded-lg bg-[var(--surface-2)] px-4 py-4 transition hover:bg-slate-100">
            <span className="block text-sm text-[var(--ink-muted)]">Overdue client tasks</span>
            <span className="mt-2 block font-[family-name:var(--font-display)] text-3xl tabular-nums text-[var(--ink)]">{analytics?.overdueTasks ?? 0}</span>
            <span className="mt-2 block text-sm font-medium text-[var(--accent)]">View team workload →</span>
          </Link>
        </div>
      </section>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

      <section className="mt-8" aria-labelledby="products-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="products-heading" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Company products
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">
              Internal tools and SaaS work, separate from client onboarding.
            </p>
          </div>
          <Link href="/products" className="text-sm font-medium text-[var(--accent)] hover:underline">
            View products
          </Link>
        </div>
        {productsError ? (
          <p className="mb-3 text-sm text-[var(--ink-muted)]">{productsError}</p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <p className="text-sm text-[var(--ink-muted)]">Products in your portfolio</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
              {products.length}
            </p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">Visible to your account</p>
          </Card>
          <Card>
            <p className="text-sm text-[var(--ink-muted)]">Open product work</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
              {products.reduce((count, product) => count + product.openWorkCount, 0)}
            </p>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">Tracked separately from client tasks</p>
          </Card>
          <Card>
            <p className="text-sm text-[var(--ink-muted)]">Live products</p>
            <p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
              {products.filter((product) => product.stage === "live").length}
            </p>
          </Card>
        </div>
        {products.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.slice(0, 3).map((product) => (
              <Card key={product.id}>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/products/${product.id}`} className="font-medium text-[var(--ink)] hover:text-[var(--accent)]">
                    {product.name}
                  </Link>
                  <Badge tone={product.stage === "live" ? "success" : "neutral"}>
                    {statusLabel(product.stage)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  {product.openWorkCount} open work item{product.openWorkCount === 1 ? "" : "s"}
                  {product.ownerName ? ` · ${product.ownerName}` : ""}
                </p>
              </Card>
            ))}
          </div>
        ) : !productsError ? (
          <p className="mt-4 text-sm text-[var(--ink-muted)]">No company products added yet.</p>
        ) : null}
      </section>
    </div>
  );
}
