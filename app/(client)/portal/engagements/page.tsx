"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, statusLabel } from "@/lib/utils";

type Engagement = {
  id: string;
  name: string;
  type: string;
  status: string;
  targetDate: string | null;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
  progress: number;
};

export default function PortalEngagementsPage() {
  const { session, token, loading: authLoading } = useAuth();
  const clientId = session?.clientId;
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ engagements: Engagement[] }>(`/api/clients/${encodeURIComponent(clientId)}/engagements`, { token });
      setEngagements(data.engagements);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load your engagements.");
    } finally { setLoading(false); }
  }, [clientId, token]);

  useEffect(() => { if (authLoading) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [authLoading, load]);

  if (authLoading || loading) return <div><PageHeader title="Engagements" description="Loading your work…" /><Card className="text-sm text-[var(--ink-muted)]">Loading…</Card></div>;
  if (!clientId) return <div><PageHeader title="Engagements" /><Card className="text-sm text-[var(--ink-muted)]">Your account needs a client workspace. Ask your Boatship administrator to connect it.</Card></div>;
  if (error) return <div><PageHeader title="Engagements" /><Card><p role="alert" className="text-sm text-[var(--ink-muted)]">{error}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">Try again</button></Card></div>;

  const current = engagements.filter((item) => item.status !== "completed" && item.status !== "cancelled");
  const history = engagements.filter((item) => item.status === "completed" || item.status === "cancelled");

  return <div className="space-y-8">
    <PageHeader title="Engagements" description="Your active work and past projects with Boatship." />
    <section aria-labelledby="current-engagements"><h2 id="current-engagements" className="mb-3 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Current work</h2><div className="grid gap-4 md:grid-cols-2">{current.length ? current.map((item) => <EngagementCard key={item.id} engagement={item} />) : <Card className="text-sm text-[var(--ink-muted)]">No current engagements.</Card>}</div></section>
    {history.length > 0 ? <section aria-labelledby="past-engagements"><h2 id="past-engagements" className="mb-3 font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">History</h2><div className="grid gap-4 md:grid-cols-2">{history.map((item) => <EngagementCard key={item.id} engagement={item} />)}</div></section> : null}
  </div>;
}

function EngagementCard({ engagement }: { engagement: Engagement }) {
  const item = engagement;
  return <Link href={`/portal/engagements/${encodeURIComponent(item.id)}`} className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 transition hover:border-[var(--brand)]/40 hover:bg-[var(--surface-2)]">
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{statusLabel(item.type)}</p><h3 className="mt-1 text-lg font-semibold text-[var(--ink)]">{item.name}</h3></div><ArrowRight className="h-5 w-5 shrink-0 text-[var(--brand)] transition group-hover:translate-x-0.5" aria-hidden="true" /></div>
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ink-muted)]"><Badge tone={item.status === "active" ? "info" : "neutral"}>{statusLabel(item.status)}</Badge><span>{item.progress}% of your tasks complete</span>{item.targetDate ? <span>Target {formatDate(item.targetDate)}</span> : null}{item.completedAt ? <span>Finished {formatDate(item.completedAt)}</span> : null}</div>
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></div>
  </Link>;
}
