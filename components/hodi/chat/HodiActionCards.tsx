"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, FileText, Mail, Send, Sparkles, Wrench } from "lucide-react";
import { Badge, Button, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type Connector = { slug: string; name: string; connected: boolean };
type Evidence = { source: string; label: string };
type Insight = {
  profile: { clientId: string; clientName: string };
  recommendations: Array<{ summary: string; evidence: Evidence[] }>;
};
type WorkflowPlan = {
  id: string;
  name: string;
  requiredConnection: string;
  status: "ready_for_review" | "unavailable" | "connection_unknown";
  nextStep: string;
  safeOutcome: string;
};
type InternalAction = "create_task" | "weekly_status_report";

type CardKind =
  | "follow_up"
  | "assets"
  | "access"
  | "drive"
  | "weekly"
  | "schedule"
  | "tasks"
  | "assign_overdue";

type ActionCardDefinition = {
  kind: CardKind;
  title: string;
  reason: string;
  workflowId?: string;
  internalAction?: InternalAction;
  draft: string;
};

function cardsForMessage(text: string): ActionCardDefinition[] {
  const cards: ActionCardDefinition[] = [];
  const add = (card: ActionCardDefinition) => {
    if (!cards.some((item) => item.kind === card.kind)) cards.push(card);
  };
  const content = text.toLowerCase();
  if (/follow[- ]?up|remind/.test(content)) add({ kind: "follow_up", title: "Draft client follow-up", reason: "Hodi identified a client follow-up in this response.", workflowId: "gmail-follow-up-draft", draft: "Hi,\n\nA quick follow-up on the onboarding items we still need to keep your project moving. Please share any outstanding files, access, or approvals when ready.\n\nThank you," });
  if (/asset|logo|brand|copy/.test(content)) add({ kind: "assets", title: "Request missing assets", reason: "Project assets are mentioned as an outstanding onboarding item.", workflowId: "gmail-follow-up-draft", draft: "Hi,\n\nTo keep the project on schedule, please share the remaining brand assets, copy, and source files. If anything is not ready yet, reply with an expected delivery date.\n\nThank you," });
  if (/access|credential|login|permission/.test(content)) add({ kind: "access", title: "Request required access", reason: "Access is needed before the next delivery step can begin.", workflowId: "gmail-follow-up-draft", draft: "Hi,\n\nPlease share the required account access or invite our team so we can continue the next project step. Let us know if you would prefer a secure access-request checklist.\n\nThank you," });
  if (/drive|folder|organize files/.test(content)) add({ kind: "drive", title: "Prepare Drive project folder", reason: "A shared location for onboarding files was recommended.", workflowId: "drive-project-assets", draft: "Create folders for 01 Brief, 02 Brand Assets, 03 Design, 04 Development, 05 Deliverables, and 06 Approvals." });
  if (/weekly|status update|progress update/.test(content)) add({ kind: "weekly", title: "Prepare weekly status update", reason: "A current project summary will make progress and blockers visible.", internalAction: "weekly_status_report", draft: "Generate a report with completed work, blockers, overdue tasks, approvals, and next actions." });
  if (/kickoff|schedule|review call|meeting/.test(content)) add({ kind: "schedule", title: "Prepare review meeting options", reason: "A kickoff, review, or launch conversation is the next suggested step.", workflowId: "calendar-meeting-options", draft: "Suggested agenda: current progress, decisions needed, blockers, next milestones, and responsibilities." });
  if (/create task|create tasks|task plan|recovery plan/.test(content)) add({ kind: "tasks", title: "Create the next internal task", reason: "Hodi recommended turning this next step into an owned Boatship task.", internalAction: "create_task", draft: "Complete the next onboarding action" });
  if (/overdue|assign.*task|task.*assign/.test(content)) add({ kind: "assign_overdue", title: "Create overdue recovery task", reason: "Overdue work needs a confirmed owner and recovery step.", internalAction: "create_task", draft: "Resolve overdue onboarding work and confirm the new owner" });
  return cards.slice(0, 2);
}

function connectionSlugs(connectors: Connector[]) {
  const aliases: Record<string, string> = { google_drive: "googledrive", googlecalendar: "google_calendar" };
  return connectors
    .filter((connector) => connector.connected)
    .map((connector) => aliases[connector.slug] || connector.slug);
}

function ActionCard({ definition, token, connectors, insights, onRun }: { definition: ActionCardDefinition; token: string | null; connectors: Connector[]; insights: Insight[]; onRun: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(definition.draft);
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const insight = insights.find((item) => item.profile.clientId === selectedClientId) || insights[0];
  const evidence = insight?.recommendations[0]?.evidence[0];
  const clientId = selectedClientId || insight?.profile.clientId;
  const isExternal = Boolean(definition.workflowId);
  const unavailable = plan?.status === "unavailable" || plan?.status === "connection_unknown";

  async function openPreview() {
    setOpen(true);
    setError(null);
    if (!definition.workflowId || plan || !token) return;
    setBusy(true);
    try {
      const response = await apiFetch<{ plan: WorkflowPlan }>("/api/agent/workflows", {
        method: "POST", token,
        body: JSON.stringify({ workflowId: definition.workflowId, availableConnections: connectionSlugs(connectors) }),
      });
      setPlan(response.plan);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not prepare this workflow."); } finally { setBusy(false); }
  }

  function payload() {
    if (!clientId) return null;
    return definition.internalAction === "weekly_status_report"
      ? { clientId }
      : { clientId, title: draft.trim() || definition.draft, description: "Created from Hodi suggested action", priority: "medium" };
  }

  async function requestApproval() {
    const actionPayload = payload();
    if (!definition.internalAction || !actionPayload || !token) return;
    setBusy(true);
    try {
      const response = await apiFetch<{ approvalToken: string }>("/api/agent/actions", {
        method: "POST", token,
        body: JSON.stringify({ mode: "propose", action: definition.internalAction, payload: actionPayload }),
      });
      setApprovalToken(response.approvalToken);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not prepare approval."); } finally { setBusy(false); }
  }

  async function execute() {
    const actionPayload = payload();
    if (!definition.internalAction || !actionPayload || !token || !approvalToken) return;
    setBusy(true);
    try {
      await apiFetch("/api/agent/actions/execute", {
        method: "POST", token,
        body: JSON.stringify({ action: definition.internalAction, payload: actionPayload, approvalToken }),
      });
      setResult(definition.internalAction === "weekly_status_report" ? "Weekly status report generated." : "Internal task created.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not execute this action."); } finally { setBusy(false); }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_0_rgba(20,20,20,0.04)]">
      <button type="button" onClick={() => void openPreview()} className="flex w-full items-start gap-3 p-3 text-left hover:bg-[var(--surface-2)]/50">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]"><Sparkles className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--ink)]">{definition.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-[var(--ink-muted)]">{definition.reason}</span></span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[var(--ink-muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="space-y-3 border-t border-[var(--border)] p-3">
        <div className="rounded-lg bg-[var(--surface-2)] p-3 text-xs"><p className="font-medium uppercase tracking-wide text-[var(--ink-muted)]">Evidence</p><p className="mt-1 text-[var(--ink)]">{evidence ? `${evidence.source}: ${evidence.label}` : insight ? `Client workspace: ${insight.profile.clientName}` : "Hodi response"}</p></div>
        {insights.length > 0 ? <label className="block text-xs font-medium text-[var(--ink-muted)]">Project
          <select value={clientId || ""} onChange={(event) => setSelectedClientId(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-2 text-sm text-[var(--ink)]">
            {insights.map((item) => <option key={item.profile.clientId} value={item.profile.clientId}>{item.profile.clientName}</option>)}
          </select>
        </label> : null}
        {editing ? <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} /> : <div className="rounded-lg border border-[var(--border)] p-3 text-sm whitespace-pre-wrap text-[var(--ink)]">{draft}</div>}
        {plan ? <div className="rounded-lg border border-[var(--border)] p-3 text-xs text-[var(--ink-muted)]"><span className="font-medium text-[var(--ink)]">{plan.name}</span><p className="mt-1">{plan.nextStep}</p></div> : null}
        {unavailable ? <p className="rounded-lg bg-[#f3ead2] p-3 text-xs text-[var(--warning)]">{plan?.nextStep}</p> : null}
        {error ? <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p> : null}
        {result ? <p className="flex items-center gap-2 rounded-lg bg-[#e4efe6] p-3 text-sm text-[var(--success)]"><CheckCircle2 className="h-4 w-4" />{result}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing((value) => !value)}><FileText className="h-4 w-4" /> {editing ? "Save draft" : "Edit"}</Button>
          {definition.internalAction ? !approvalToken ? <Button size="sm" onClick={() => void requestApproval()} disabled={!clientId || busy || Boolean(result)}><Wrench className="h-4 w-4" /> {busy ? "Preparing…" : "Approve internal action"}</Button> : <Button size="sm" onClick={() => void execute()} disabled={busy || Boolean(result)}><CheckCircle2 className="h-4 w-4" /> {busy ? "Executing…" : "Approve & execute"}</Button> : null}
          {isExternal && !unavailable ? <Button size="sm" variant="secondary" onClick={() => onRun(`For ${insight?.profile.clientName || "this client"}, ${definition.draft} Use my connected ${plan?.requiredConnection === "googledrive" ? "Google Drive" : "app"} and show me the result.`)}><Mail className="h-4 w-4" /> Run with Hodi</Button> : null}
        </div>
        {isExternal ? <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]"><Send className="h-3 w-3" /> Connected tools can run through Hodi; external sends remain approval-only.</p> : null}
      </div> : null}
    </section>
  );
}

export function HodiActionCards({ text, token, connectors, onRun }: { text: string; token: string | null; connectors: Connector[]; onRun: (prompt: string) => void }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const cards = useMemo(() => cardsForMessage(text), [text]);
  useEffect(() => {
    if (!token || cards.length === 0) return;
    void apiFetch<{ insights: Insight[] }>("/api/agent/insights", { token }).then((response) => setInsights(response.insights)).catch(() => setInsights([]));
  }, [token, cards.length]);
  if (cards.length === 0) return null;
  return <div className="space-y-2 pt-1">{cards.map((definition) => <ActionCard key={definition.kind} definition={definition} token={token} connectors={connectors} insights={insights} onRun={onRun} />)}</div>;
}
