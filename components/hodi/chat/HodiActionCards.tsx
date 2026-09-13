"use client";

import { CheckCircle2, CircleAlert, Clock3, Wrench } from "lucide-react";

export type HodiActionArtifact = { id: string; name: string; state?: string; error?: boolean };

function statusFor(action: HodiActionArtifact) {
  if (action.error || action.state === "output-error") return { label: "Needs attention", tone: "text-[var(--danger)]", Icon: CircleAlert };
  if (action.state === "output-available") return { label: "Complete", tone: "text-[var(--success)]", Icon: CheckCircle2 };
  if (action.state === "approval-requested" || action.state === "output-denied") return { label: action.state === "output-denied" ? "Not approved" : "Awaiting approval", tone: "text-[var(--warning)]", Icon: Clock3 };
  return { label: "In progress", tone: "text-[var(--ink-muted)]", Icon: Clock3 };
}

/** Displays structured agent tool artifacts; it never infers actions from prose. */
export function HodiActionCards({ actions }: { actions: HodiActionArtifact[] }) {
  const uniqueActions = actions.filter((action, index, all) => all.findIndex((item) => item.id === action.id) === index).slice(0, 4);
  if (!uniqueActions.length) return null;
  return <section aria-label="Hodi actions" className="space-y-2 pt-1"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Action updates</p><div className="grid gap-2 sm:grid-cols-2">{uniqueActions.map((action) => { const status = statusFor(action); const Icon = status.Icon; return <div key={action.id} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 shadow-[0_1px_0_rgba(20,20,20,0.04)]"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]"><Wrench className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--ink)]">{action.name}</span><span className={`mt-0.5 flex items-center gap-1 text-[11px] ${status.tone}`}><Icon className="h-3 w-3" />{status.label}</span></span></div>; })}</div></section>;
}
