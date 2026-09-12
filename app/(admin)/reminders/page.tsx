"use client";

import { useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Card, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type Finding = { taskId: string; taskTitle: string; clientName: string; reason: string; detail: string; lastGitActivityAt: string | null };

export default function RemindersPage() {
  const { token } = useAuth();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dryRun, setDryRun] = useState(true);

  async function runScan() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch<{ findings: Finding[] }>("/api/reminders/scan", { token, method: "POST", body: JSON.stringify({ dryRun, reasons: ["overdue", "stale", "suspicious_completion"] }) });
      setFindings(response.findings);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to run reminder scan"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <PageHeader title="Reminder automation" description="Find overdue work, tasks with no recent Git activity, and completions that need evidence." />
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="font-medium text-[var(--ink)]">Safe dispatch mode</p><p className="mt-1 text-sm text-[var(--ink-muted)]">Dry run previews recipients and channels without sending external notifications.</p></div>
      <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run</label><button type="button" onClick={() => void runScan()} disabled={busy} className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Scanning…" : "Run scan"}</button></div>
    </Card>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    <Card><div className="flex items-center justify-between"><div><h2 className="font-semibold text-[var(--ink)]">Findings</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{findings.length} reminder candidate{findings.length === 1 ? "" : "s"}</p></div><Badge tone={findings.length ? "warning" : "success"}>{findings.length ? "Needs attention" : "Clear"}</Badge></div>
      {findings.length ? <div className="mt-5 divide-y divide-[var(--border)]">{findings.map((finding) => <div key={`${finding.taskId}-${finding.reason}`} className="py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[var(--ink)]">{finding.taskTitle}</p><Badge tone={finding.reason === "suspicious_completion" ? "danger" : "warning"}>{finding.reason.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-sm text-[var(--ink-muted)]">{finding.clientName} · {finding.detail}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Last Git activity: {finding.lastGitActivityAt ? new Date(finding.lastGitActivityAt).toLocaleString() : "none recorded"}</p></div>)}</div> : <p className="mt-5 text-sm text-[var(--ink-muted)]">Run a scan to preview reminder candidates.</p>}
    </Card>
  </div>;
}
