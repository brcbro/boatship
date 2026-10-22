"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Textarea } from "@/components/shared/ui";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { hasPermission } from "@/lib/rbac";
import { formatDate, statusLabel } from "@/lib/utils";
import type { ClientWithProgress } from "@/types";

type Report = { clientId: string; companyName: string; health: { score: number; label: string; overdue: number; blocked: number; pendingApprovals: number }; completedTasks: number; activeTasks: number; evidenceCount: number };
type Ops = { milestones: Array<{ id: string; clientId: string; engagementId?: string | null; title: string; dueDate: string | null; status: string }>; approvals: Array<{ id: string; clientId: string; engagementId?: string | null; subject: string; status: string; kind: string; reviewNote?: string | null }>; reports: Report[] };
type Engagement = { id: string; name: string; status: string };

export default function ProjectsOperationsPage() {
  const { token, session } = useAuth();
  const canManage = !!session && hasPermission(session, "clients.manage");
  const [ops, setOps] = useState<Ops | null>(null);
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [clientId, setClientId] = useState("");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [scope, setScope] = useState("all");
  const [includeAccountWide, setIncludeAccountWide] = useState(true);
  const [createEngagementId, setCreateEngagementId] = useState("");
  const [action, setAction] = useState<"milestone" | "approval">("milestone");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("document");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingEngagements, setLoadingEngagements] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [operations, clientData] = await Promise.all([apiFetch<Ops>("/api/project-operations", { token }), apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token })]);
      setOps(operations); setClients(clientData.clients);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load operations"); }
    finally { setLoading(false); }
  }, [token]);
  // Data loading is intentionally effect-driven because the auth token is client state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    void apiFetch<{ engagements: Engagement[] }>(`/api/clients/${encodeURIComponent(clientId)}/engagements`, { token, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setEngagements(data.engagements); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load engagements."); })
      .finally(() => { if (!controller.signal.aborted) setLoadingEngagements(false); });
    return () => controller.abort();
  }, [clientId, token]);
  const selected = useMemo(() => clients.find((client) => client.id === clientId), [clients, clientId]);
  const belongs = (item: { clientId: string; engagementId?: string | null }) => (!clientId || item.clientId === clientId) && (scope === "all" || (scope === "account" ? !item.engagementId : item.engagementId === scope || includeAccountWide && !item.engagementId));
  const milestones = (ops?.milestones || []).filter(belongs);
  const approvals = (ops?.approvals || []).filter(belongs);
  const reports = (ops?.reports || []).filter((report) => !clientId || report.clientId === clientId);
  const contextLabel = (engagementId?: string | null) => !engagementId ? "Account-wide" : engagements.find((engagement) => engagement.id === engagementId)?.name || "Historical engagement";
  function chooseClient(next: string) { setClientId(next); setEngagements([]); setScope("all"); setCreateEngagementId(""); setNotice(""); setLoadingEngagements(Boolean(next)); }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !selected || !title.trim()) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await apiFetch("/api/project-operations", { method: "POST", token, body: JSON.stringify({ action, clientId, engagementId: createEngagementId || null, ...(action === "milestone" ? { title: title.trim(), dueDate: dueDate || null } : { subject: title.trim(), kind }), description: description.trim() }) });
      setTitle(""); setDescription(""); setDueDate(""); setNotice(`${action === "milestone" ? "Milestone created" : "Approval requested"} for ${selected.companyName} · ${contextLabel(createEngagementId)}.`); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the milestone. Try again.");
    } finally { setSaving(false); }
  }
  return <div className="space-y-6">
    <PageHeader title="Project operations" description="Milestones, approvals, workload signals, and evidence-based health in one view." />
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
    <section aria-label="Project operations filters" className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:max-w-xs"><Label htmlFor="operations-client">Client account</Label><Select id="operations-client" value={clientId} onChange={(event) => chooseClient(event.target.value)} disabled={saving}><option value="">All client accounts</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}</Select></div>
      <div className="w-full sm:max-w-xs"><Label htmlFor="operations-scope">Show work for</Label><Select id="operations-scope" value={scope} onChange={(event) => setScope(event.target.value)} disabled={loadingEngagements || saving}><option value="all">All engagements and account work</option><option value="account">Account-wide work</option>{engagements.map((engagement) => <option key={engagement.id} value={engagement.id}>{engagement.name}</option>)}</Select></div>
      {scope !== "all" && scope !== "account" ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeAccountWide} onChange={(event) => setIncludeAccountWide(event.target.checked)} />Include account-wide work</label> : null}
    </section>
    {loading ? <p role="status" className="text-sm text-[var(--ink-muted)]">Loading project operations…</p> : reports.length ? <section aria-label="Account delivery health" className="grid gap-4 md:grid-cols-3">{reports.map((report) => <Card key={report.clientId}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{report.companyName}</p><Badge tone={report.health.score >= 75 ? "success" : report.health.score >= 45 ? "warning" : "danger"}>{report.health.score} · {report.health.label}</Badge></div><p className="mt-3 text-sm text-[var(--ink-muted)]">{report.completedTasks} completed · {report.activeTasks} active · {report.evidenceCount} evidence events</p><p className="mt-2 text-sm text-[var(--ink-muted)]">{report.health.overdue} overdue · {report.health.blocked} blocked · {report.health.pendingApprovals} approvals waiting</p><p className="mt-2 text-xs text-[var(--ink-muted)]">Account delivery summary</p></Card>)}</section> : null}
    {canManage ? <Card><h2 className="font-[family-name:var(--font-display)] text-xl">Create work or request a decision</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Choose a client account above, then connect this item to an engagement or keep it account-wide.</p><form onSubmit={(event) => void create(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor="operations-create-type">Create</Label><Select id="operations-create-type" value={action} disabled={saving} onChange={(event) => setAction(event.target.value as "milestone" | "approval")}><option value="milestone">Milestone</option><option value="approval">Client approval request</option></Select></div>
      <div><Label htmlFor="operations-create-engagement">Engagement (optional)</Label><Select id="operations-create-engagement" value={createEngagementId} disabled={!clientId || saving || loadingEngagements} onChange={(event) => setCreateEngagementId(event.target.value)}><option value="">Account-wide work</option>{engagements.map((engagement) => <option key={engagement.id} value={engagement.id} disabled={engagement.status === "completed" || engagement.status === "cancelled"}>{engagement.name} · {statusLabel(engagement.status)}</option>)}</Select></div>
      <div className="sm:col-span-2"><Label htmlFor="operations-title">{action === "milestone" ? "Milestone title" : "Decision requested"}</Label><Input id="operations-title" value={title} maxLength={160} required disabled={saving || !clientId} onChange={(event) => setTitle(event.target.value)} placeholder={action === "milestone" ? "e.g. Client review complete" : "e.g. Approve the final design"} /></div>
      <div className="sm:col-span-2"><Label htmlFor="operations-description">Description (optional)</Label><Textarea id="operations-description" rows={3} value={description} maxLength={2000} disabled={saving || !clientId} onChange={(event) => setDescription(event.target.value)} /></div>
      {action === "milestone" ? <div><Label htmlFor="operations-due-date">Due date (optional)</Label><Input id="operations-due-date" type="date" value={dueDate} disabled={saving || !clientId} onChange={(event) => setDueDate(event.target.value)} /></div> : <div><Label htmlFor="operations-approval-kind">Decision type</Label><Select id="operations-approval-kind" value={kind} disabled={saving || !clientId} onChange={(event) => setKind(event.target.value)}><option value="document">Document</option><option value="design">Design</option><option value="release">Release</option></Select></div>}
      <div className="flex items-end"><Button type="submit" disabled={saving || !selected || !title.trim() || loadingEngagements}>{saving ? "Saving…" : action === "milestone" ? "Create milestone" : "Request client approval"}</Button></div>
    </form></Card> : null}
    <section aria-labelledby="operations-queue"><h2 id="operations-queue" className="font-[family-name:var(--font-display)] text-xl">Milestones and client decisions</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Account-wide work and historical records remain available through the filters.</p>{!loading && !milestones.length && !approvals.length ? <EmptyState title="No work in this view" description="Choose another account or engagement, or create a milestone or approval request." /> : <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {milestones.map((item) => <article key={item.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="break-words font-semibold">{item.title}</h3><Badge tone={item.status === "completed" ? "success" : "info"}>{statusLabel(item.status)}</Badge></div><p className="mt-1 text-sm text-[var(--ink-muted)]">{clients.find((client) => client.id === item.clientId)?.companyName || "Client account"} · {contextLabel(item.engagementId)}{item.dueDate ? ` · Due ${formatDate(item.dueDate)}` : ""}</p></article>)}
      {approvals.map((item) => <article key={item.id} className="py-4"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="break-words font-semibold">{item.subject}</h3><Badge tone={item.status === "approved" ? "success" : item.status === "changes_requested" ? "warning" : "neutral"}>{statusLabel(item.status)}</Badge></div><p className="mt-1 text-sm text-[var(--ink-muted)]">{statusLabel(item.kind)} decision · {clients.find((client) => client.id === item.clientId)?.companyName || "Client account"} · {contextLabel(item.engagementId)}</p>{item.reviewNote ? <p className="mt-3 whitespace-pre-wrap break-words text-sm"><span className="font-semibold">Client review note:</span> {item.reviewNote}</p> : null}</article>)}
    </div>}</section>
  </div>;
}
