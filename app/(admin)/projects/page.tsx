"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import type { ClientWithProgress } from "@/types";

type Report = { clientId: string; companyName: string; health: { score: number; label: string; overdue: number; blocked: number; pendingApprovals: number }; completedTasks: number; activeTasks: number; evidenceCount: number };
type Ops = { milestones: Array<{ id: string; clientId: string; title: string; dueDate: string | null; status: string }>; approvals: Array<{ id: string; clientId: string; subject: string; status: string; kind: string }>; reports: Report[] };

export default function ProjectsOperationsPage() {
  const { token } = useAuth();
  const [ops, setOps] = useState<Ops | null>(null);
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [operations, clientData] = await Promise.all([apiFetch<Ops>("/api/project-operations", { token }), apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token })]);
      setOps(operations); setClients(clientData.clients);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load operations"); }
  }, [token]);
  // Data loading is intentionally effect-driven because the auth token is client state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => clients.find((client) => client.id === clientId), [clients, clientId]);
  async function addMilestone() {
    if (!selected || !title.trim()) return;
    await apiFetch("/api/project-operations", { method: "POST", token, body: JSON.stringify({ action: "milestone", clientId, title: title.trim() }) });
    setTitle(""); await load();
  }
  return <div className="space-y-6">
    <PageHeader title="Project operations" description="Milestones, approvals, workload signals, and evidence-based health in one view." />
    {error ? <p className="text-sm text-red-700">{error}</p> : null}
    <div className="grid gap-4 md:grid-cols-3">{(ops?.reports || []).map((report) => <Card key={report.clientId}><div className="flex items-center justify-between gap-2"><p className="font-medium">{report.companyName}</p><Badge tone={report.health.score >= 75 ? "success" : report.health.score >= 45 ? "warning" : "danger"}>{report.health.score} · {report.health.label}</Badge></div><p className="mt-3 text-xs text-[var(--ink-muted)]">{report.completedTasks} completed · {report.activeTasks} active · {report.evidenceCount} evidence events</p><p className="mt-2 text-xs text-[var(--ink-muted)]">{report.health.overdue} overdue · {report.health.blocked} blocked · {report.health.pendingApprovals} approvals waiting</p></Card>)}</div>
    <Card><p className="font-medium">Add milestone</p><div className="mt-3 flex flex-wrap gap-2"><select value={clientId} onChange={(event) => setClientId(event.target.value)} className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"><option value="">Choose project</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}</select><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Milestone title" className="min-w-56 rounded-md border border-[var(--border)] px-3 py-2 text-sm" /><Button onClick={() => void addMilestone()} disabled={!selected || !title.trim()}>Create milestone</Button></div></Card>
    <Card><p className="font-medium">Milestone and approval queue</p><p className="text-xs text-[var(--ink-muted)]">Client decisions stay attached to the project instead of getting lost in email.</p>{(ops?.milestones || []).length === 0 && (ops?.approvals || []).length === 0 ? <EmptyState title="No project operations yet" description="Create a milestone or request a client approval from a project workspace." /> : <div className="mt-4 grid gap-2 md:grid-cols-2">{(ops?.milestones || []).map((item) => <div key={item.id} className="rounded-md border border-[var(--border)] p-3 text-sm"><div className="flex justify-between gap-3"><span>{item.title}</span><Badge tone={item.status === "completed" ? "success" : "info"}>{item.status}</Badge></div><p className="mt-1 text-xs text-[var(--ink-muted)]">{clients.find((client) => client.id === item.clientId)?.companyName || "Project"}{item.dueDate ? ` · due ${new Date(item.dueDate).toLocaleDateString()}` : ""}</p></div>)}{(ops?.approvals || []).map((item) => <div key={item.id} className="rounded-md border border-[var(--border)] p-3 text-sm"><div className="flex justify-between gap-3"><span>{item.subject}</span><Badge tone={item.status === "approved" ? "success" : item.status === "changes_requested" ? "warning" : "neutral"}>{item.status}</Badge></div><p className="mt-1 text-xs text-[var(--ink-muted)]">{item.kind} · {clients.find((client) => client.id === item.clientId)?.companyName || "Project"}</p></div>)}</div>}</Card>
  </div>;
}
