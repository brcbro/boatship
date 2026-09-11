"use client";

import { CheckCircle2, ExternalLink, LoaderCircle, ShieldAlert, Unplug } from "lucide-react";
import { Badge, Button, Card } from "@/components/shared/ui";

export type ActionPreviewData = { id: string; title: string; description: string; source: string; evidence: string; risk: "Low" | "Moderate" | "High"; confirmation: "Not required" | "Awaiting approval" | "Approved"; integration?: string; unavailable?: boolean; resultLabel?: string; mode?: "internal" | "external" | "draft" | "read"; changes?: string[]; status?: "idle" | "planning" | "ready" | "executing" | "complete" | "error"; result?: string; error?: string; onPreview?: () => void; onApprove?: () => void };

function riskTone(risk: ActionPreviewData["risk"]): "success" | "warning" | "danger" { return risk === "Low" ? "success" : risk === "Moderate" ? "warning" : "danger"; }

export function ActionPreview({ action }: { action: ActionPreviewData }) {
  const busy = action.status === "planning" || action.status === "executing";
  const canApprove = action.mode === "internal" && action.status === "ready" && !action.unavailable;
  const previewLabel = action.mode === "draft" ? "View draft" : action.mode === "read" ? "View plan" : "Preview action";
  return <Card className="space-y-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-medium text-[var(--ink)]">{action.title}</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">{action.description}</p></div><Badge tone={riskTone(action.risk)}>{action.risk} risk</Badge></div>
    <div className="grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg bg-[var(--surface-2)] p-3"><p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">Source</p><p className="mt-1 font-medium text-[var(--ink)]">{action.source}</p></div><div className="rounded-lg bg-[var(--surface-2)] p-3"><p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">Evidence</p><p className="mt-1 text-[var(--ink)]">{action.evidence}</p></div></div>
    {action.changes?.length ? <div className="rounded-lg border border-[var(--brand)]/20 bg-[var(--surface-2)] p-3 text-sm"><p className="font-medium text-[var(--ink)]">Hodi will</p><ul className="mt-2 space-y-1 text-[var(--ink-muted)]">{action.changes.map((change) => <li key={change}>• {change}</li>)}</ul></div> : null}
    {action.unavailable ? <div className="flex gap-2 rounded-lg border border-[var(--warning)]/25 bg-[#f3ead2]/55 p-3 text-sm text-[var(--ink)]"><Unplug className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" /><p><span className="font-medium">{action.integration || "Integration"} is unavailable.</span> Hodi kept this as a reviewable plan and will not perform an external action.</p></div> : null}
    {action.result ? <div className="rounded-lg border border-[var(--success)]/25 bg-[var(--success)]/10 p-3 text-sm text-[var(--ink)]"><span className="font-medium">Result:</span> {action.result}</div> : null}{action.error ? <div className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/10 p-3 text-sm text-[var(--ink)]">{action.error}</div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3"><div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">{action.confirmation === "Approved" || action.confirmation === "Not required" ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />}<span>{action.confirmation}</span></div><div className="flex items-center gap-2">{action.resultLabel ? <Button size="sm" variant="ghost" disabled title="Available when an action returns a link"><ExternalLink className="h-4 w-4" /> {action.resultLabel}</Button> : null}{canApprove ? <Button size="sm" onClick={action.onApprove} disabled={busy}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve & execute</Button> : null}{action.status !== "complete" ? <Button size="sm" variant="secondary" onClick={action.onPreview} disabled={busy || action.unavailable || (!action.onPreview && !canApprove)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{action.status === "ready" ? "Preview ready" : previewLabel}</Button> : null}</div></div>
  </Card>;
}
