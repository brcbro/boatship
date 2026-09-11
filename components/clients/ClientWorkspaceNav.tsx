"use client";

import { cn } from "@/lib/utils";

export function ClientWorkspaceNav({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  const items = [
    ["overview", "Workspace"], ["forms", "Briefs & approvals"], ["documents", "Files & assets"],
    ["tasks", "Deliverables"], ["vessels", "Access & details"], ["activity", "Timeline"],
  ];
  return <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-px [scrollbar-gutter:stable]" aria-label="Client workspace sections">
    {items.map(([id, label]) => <button key={id} type="button" onClick={() => onChange(id)} className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition sm:px-4", active === id ? "border-[var(--brand)] text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]")}>{label}</button>)}
  </nav>;
}
