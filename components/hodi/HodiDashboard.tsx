"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, BellRing, CalendarClock, CircleAlert, FileCheck2, Filter, ListChecks, LoaderCircle, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { ActionPreview, type ActionPreviewData } from "@/components/hodi/ActionPreview";
import { Badge, Button, Card, PageHeader } from "@/components/shared/ui";

type Evidence = { source: string; label: string };
type Recommendation = { kind: "blocker" | "next_action" | "risk" | "launch_approval"; summary: string; owner: string; evidence: Evidence[] };
type Insight = { profile: { clientId: string; clientName: string; deadline?: { value?: string | null }; phase?: { value?: string | null } }; health: { state: string; score: number }; recommendations: Recommendation[] };
type Reminder = { title?: string; subject?: string; body?: string; clientName?: string; type?: string; [key: string]: unknown };
type Workflow = { id: string; name: string; description: string; requiredConnection: string; mode: "read" | "draft" | "action"; requiresConfirmation: boolean; safeOutcome: string };
type Category = "all" | "attention" | "blocked" | "approvals" | "drafts" | "milestones" | "recommended";
type QueueItem = ActionPreviewData & { category: Category; action?: string; payload?: Record<string, unknown>; approvalToken?: string };

const filters: Array<{ id: Category; label: string }> = [
  { id: "all", label: "All work" }, { id: "attention", label: "Needs attention" }, { id: "blocked", label: "Blocked" },
  { id: "approvals", label: "Approvals waiting" }, { id: "drafts", label: "Drafts ready" }, { id: "milestones", label: "Milestones" }, { id: "recommended", label: "Recommended" },
];
const failText = (value: unknown) => value instanceof Error ? value.message : "Hodi could not complete that request.";
const evidence = (item: Recommendation) => item.evidence[0] ? `${item.evidence[0].source}: ${item.evidence[0].label}` : "Onboarding workspace";
const risk = (kind: Recommendation["kind"]): "Low" | "Moderate" | "High" => kind === "blocker" || kind === "risk" ? "High" : kind === "launch_approval" ? "Moderate" : "Low";

export function HodiDashboard() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [state, setState] = useState<QueueItem[]>([]);
  const [filter, setFilter] = useState<Category>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const responses = await Promise.allSettled([
      fetch("/api/agent/insights").then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load onboarding insights."))),
      fetch("/api/reminders").then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load reminder drafts."))),
      fetch("/api/agent/workflows").then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load workflow plans."))),
    ]);
    if (responses[0].status === "fulfilled") setInsights(responses[0].value.insights || []);
    if (responses[1].status === "fulfilled") setReminders(responses[1].value.reminders || []);
    if (responses[2].status === "fulfilled") setWorkflows(responses[2].value.workflows || []);
    if (responses.some((result) => result.status === "rejected")) setError(responses.every((result) => result.status === "rejected") ? "Hodi’s live queue is unavailable right now. Try refreshing." : "Some Hodi signals could not be loaded. Available work is still shown.");
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const queue = useMemo<QueueItem[]>(() => {
    const recommendations = insights.flatMap((insight) => insight.recommendations.map((recommendation, index) => ({
      id: `${insight.profile.clientId}-${recommendation.kind}-${index}`,
      category: recommendation.kind === "blocker" ? "blocked" : recommendation.kind === "launch_approval" ? "approvals" : "recommended" as Category,
      title: `${insight.profile.clientName}: ${recommendation.summary}`, description: `Owner: ${recommendation.owner}. Health: ${insight.health.state} (${insight.health.score}/100).`,
      source: insight.profile.phase?.value || "Client onboarding workspace", evidence: evidence(recommendation), risk: risk(recommendation.kind), confirmation: "Not required" as const, mode: "read" as const,
    })));
    const reports = insights.map((insight) => ({
      id: `report-${insight.profile.clientId}`, category: "recommended" as Category, title: `Prepare weekly status report for ${insight.profile.clientName}`,
      description: "Generate an internal report covering work, blockers, progress, and next steps.", source: "Client project memory", evidence: `Health score: ${insight.health.score}/100`,
      risk: "Low" as const, confirmation: "Awaiting approval" as const, mode: "internal" as const, action: "weekly_status_report", payload: { clientId: insight.profile.clientId }, status: "idle" as const,
    }));
    const drafts = reminders.map((reminder, index) => ({
      id: `reminder-${index}`, category: "drafts" as Category, title: String(reminder.subject || reminder.title || reminder.type || "Review follow-up draft"),
      description: String(reminder.body || "A client follow-up draft is ready for review. It has not been sent."), source: String(reminder.clientName || "Onboarding reminder queue"), evidence: String(reminder.type || "Missing input or overdue onboarding work"),
      risk: "Moderate" as const, confirmation: "Not required" as const, mode: "draft" as const, integration: "Email", status: "idle" as const,
    }));
    const integrations = workflows.map((workflow) => ({
      id: `workflow-${workflow.id}`, category: (workflow.mode === "draft" ? "drafts" : "attention") as Category, title: workflow.name, description: workflow.description,
      source: "Hodi integration workflow", evidence: workflow.safeOutcome, risk: workflow.requiresConfirmation ? "Moderate" as const : "Low" as const, confirmation: workflow.requiresConfirmation ? "Awaiting approval" as const : "Not required" as const,
      mode: workflow.mode === "action" ? "external" as const : workflow.mode, integration: workflow.requiredConnection, status: "idle" as const,
    }));
    return [...reports, ...recommendations, ...drafts, ...integrations];
  }, [insights, reminders, workflows]);

  const update = (id: string, patch: Partial<QueueItem>) => setState((items) => {
    const current = items.find((item) => item.id === id);
    return current ? items.map((item) => item.id === id ? { ...item, ...patch } : item) : [...items, { ...queue.find((item) => item.id === id)!, ...patch }];
  });
  const liveQueue = queue.map((item) => ({ ...item, ...state.find((change) => change.id === item.id) }));
  const shown = filter === "all" ? liveQueue : liveQueue.filter((item) => item.category === filter || filter === "attention" && item.category === "recommended");
  const counts = {
    attention: insights.filter((item) => item.health.state !== "On track").length,
    blocked: insights.reduce((total, item) => total + item.recommendations.filter((rec) => rec.kind === "blocker").length, 0),
    approvals: insights.reduce((total, item) => total + item.recommendations.filter((rec) => rec.kind === "launch_approval").length, 0),
    drafts: reminders.length, milestones: insights.filter((item) => item.profile.deadline?.value).length,
  };
  const metrics = [
    { label: "Needs attention", value: counts.attention, detail: "Projects with an open onboarding signal", icon: UsersRound, tone: "warning" as const },
    { label: "Blocked", value: counts.blocked, detail: "Work waiting on a decision or input", icon: CircleAlert, tone: "danger" as const },
    { label: "Approvals waiting", value: counts.approvals, detail: "Launch or delivery reviews to resolve", icon: FileCheck2, tone: "info" as const },
    { label: "Drafts ready", value: counts.drafts, detail: "Reviewable, never sent automatically", icon: BellRing, tone: "success" as const },
  ];

  async function preview(item: QueueItem) {
    if (item.mode !== "internal" || !item.action || !item.payload) return;
    update(item.id, { status: "planning", error: undefined });
    try {
      const response = await fetch("/api/agent/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "propose", action: item.action, payload: item.payload }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Hodi could not prepare this action.");
      update(item.id, { status: "ready", approvalToken: data.approvalToken, changes: data.preview?.changes || [], description: data.preview?.title || item.description });
    } catch (reason) { update(item.id, { status: "error", error: failText(reason) }); }
  }
  async function approve(item: QueueItem) {
    if (!item.action || !item.payload || !item.approvalToken) return;
    update(item.id, { status: "executing", error: undefined });
    try {
      const response = await fetch("/api/agent/actions/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: item.action, payload: item.payload, approvalToken: item.approvalToken }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Hodi could not execute this action.");
      update(item.id, { status: "complete", confirmation: "Approved", result: "Completed and recorded in the client activity timeline." });
    } catch (reason) { update(item.id, { status: "error", error: failText(reason) }); }
  }

  return <div className="mx-auto max-w-7xl space-y-8">
    <PageHeader title="Hodi work queue" description="Live onboarding signals, reviewable drafts, and approval-gated internal work." actions={<><Button variant="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{loading ? "Refreshing" : "Refresh queue"}</Button><Link href="/agent" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)]">Open Hodi <ArrowRight className="h-4 w-4" /></Link></>} />
    <div className="rounded-2xl border border-[var(--brand)]/20 bg-[linear-gradient(120deg,var(--surface-raised),var(--surface-2))] p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white"><Sparkles className="h-5 w-5" /></span><div><p className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Today&apos;s onboarding pulse</p><p className="mt-1 text-sm text-[var(--ink-muted)]">Hodi monitors the workspace, prepares the next step, and keeps external work review-only.</p></div></div><Badge tone="info">{loading ? "Syncing live data" : "Live work queue"}</Badge></div></div>
    {error ? <div className="rounded-xl border border-[var(--warning)]/30 bg-[#f3ead2]/55 p-4 text-sm text-[var(--ink)]">{error}</div> : null}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, detail, icon: Icon, tone }) => <Card key={label} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-[var(--ink-muted)]">{label}</p><p className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">{loading ? "—" : value}</p></div><span className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--brand)]"><Icon className="h-4 w-4" /></span></div><div className="mt-3"><Badge tone={tone}>{detail}</Badge></div></Card>)}</section>
    <section className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><Card><div className="flex items-center justify-between gap-3"><div><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Recommended now</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Ordered from recorded onboarding evidence.</p></div><ListChecks className="h-5 w-5 text-[var(--brand)]" /></div><ol className="mt-5 space-y-1">{insights.flatMap((item) => item.recommendations.filter((rec) => rec.kind !== "risk").slice(0, 1).map((rec) => ({ client: item.profile.clientName, rec }))).slice(0, 4).map(({ client, rec }, index) => <li key={`${client}-${rec.summary}`} className="flex gap-3 border-b border-[var(--border)] py-4 last:border-0"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--ink)]">{index + 1}</span><div><p className="font-medium text-[var(--ink)]">{client}</p><p className="mt-1 text-sm text-[var(--ink-muted)]">{rec.summary}</p></div></li>)}{!loading && !insights.length ? <li className="py-8 text-sm text-[var(--ink-muted)]">No recommendations are available yet.</li> : null}</ol></Card><Card><div className="flex items-center justify-between gap-3"><div><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Upcoming milestones</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Deadlines recorded in each client&apos;s project memory.</p></div><CalendarClock className="h-5 w-5 text-[var(--brand)]" /></div><div className="mt-5 space-y-4">{insights.filter((item) => item.profile.deadline?.value).slice(0, 4).map((item) => <div key={item.profile.clientId} className="border-l-2 border-[var(--brand)] pl-3"><p className="font-medium text-[var(--ink)]">{item.profile.clientName}</p><p className="mt-1 text-sm text-[var(--ink-muted)]">{item.profile.deadline?.value} · {item.profile.phase?.value || "Onboarding"}</p></div>)}{!loading && !counts.milestones ? <p className="py-8 text-sm text-[var(--ink-muted)]">No client milestones are recorded yet.</p> : null}</div></Card></section>
    <section className="space-y-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">Actionable queue</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Internal actions need explicit approval. External actions remain a reviewable plan or draft.</p></div><div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]"><ShieldCheck className="h-4 w-4 text-[var(--success)]" /> Safety controls active</div></div><div className="flex flex-wrap gap-2"><Filter className="mt-2 h-4 w-4 text-[var(--ink-muted)]" />{filters.map((item) => <Button key={item.id} size="sm" variant={filter === item.id ? "primary" : "secondary"} onClick={() => setFilter(item.id)}>{item.label}</Button>)}</div>{loading ? <Card className="flex items-center gap-3 p-8 text-sm text-[var(--ink-muted)]"><LoaderCircle className="h-5 w-5 animate-spin text-[var(--brand)]" />Building Hodi&apos;s work queue…</Card> : shown.length ? <div className="grid gap-4 lg:grid-cols-2">{shown.map((item) => <ActionPreview key={item.id} action={{ ...item, onPreview: item.mode === "internal" ? () => void preview(item) : undefined, onApprove: item.mode === "internal" ? () => void approve(item) : undefined }} />)}</div> : <Card className="p-8 text-center"><p className="font-medium text-[var(--ink)]">Nothing needs attention in this view.</p><p className="mt-1 text-sm text-[var(--ink-muted)]">Try another filter or refresh the queue.</p></Card>}</section>
  </div>;
}
