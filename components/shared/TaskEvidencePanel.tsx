"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/shared/ui";
import { apiFetch, getStoredToken } from "@/lib/api-client";

type EvidenceResponse = { runs: Array<{ id: string; status: string; reason?: string | null; source: string; createdAt: string }>; evidence: Array<{ id: string; kind: string; title: string; url?: string | null; createdAt: string }>; approval?: { status: string; note?: string | null } | null };

export function TaskEvidencePanel({ taskId, canValidate = false }: { taskId: string; canValidate?: boolean }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try { setData(await apiFetch<EvidenceResponse>(`/api/tasks/${taskId}/evidence`, { token: getStoredToken() })); } catch (e) { setError(e instanceof Error ? e.message : "Evidence unavailable"); }
  };
  useEffect(() => {
    let active = true;
    void apiFetch<EvidenceResponse>(`/api/tasks/${taskId}/evidence`, { token: getStoredToken() })
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Evidence unavailable"); });
    return () => { active = false; };
  }, [taskId]);
  async function validate() {
    setBusy(true); setError("");
    try { await apiFetch(`/api/tasks/${taskId}/validate-progress`, { method: "POST", token: getStoredToken(), body: JSON.stringify({ source: "manual" }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Validation failed"); }
    finally { setBusy(false); }
  }
  return <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]/40 p-3">
    <div className="mb-2 flex items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink)]">Git evidence</p><p className="text-xs text-[var(--ink-muted)]">Commits, checks, PRs, and approval gates</p></div>{canValidate ? <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void validate()}>{busy ? "Checking…" : "Validate progress"}</Button> : null}</div>
    {error ? <p className="mb-2 text-xs text-[var(--danger)]">{error}</p> : null}
    {!data?.runs.length && !data?.evidence.length ? <p className="text-sm text-[var(--ink-muted)]">No Git evidence captured yet.</p> : <div className="space-y-2">{data?.approval ? <div className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1.5 text-sm"><span>Manager approval</span><Badge tone={data.approval.status === "approved" ? "success" : data.approval.status === "rejected" ? "danger" : "warning"}>{data.approval.status}</Badge></div> : null}{data?.runs.map((run) => <div key={run.id} className="flex items-start justify-between gap-3 rounded border border-[var(--border)] px-2 py-1.5"><div><p className="text-sm text-[var(--ink)]">Validation · {run.source}</p><p className="text-xs text-[var(--ink-muted)]">{run.reason || new Date(run.createdAt).toLocaleString()}</p></div><Badge tone={run.status === "verified" ? "success" : run.status === "failed" ? "danger" : "warning"}>{run.status}</Badge></div>)}{data?.evidence.map((item) => <a key={item.id} href={item.url || undefined} target="_blank" rel="noreferrer" className="block rounded border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--ink)] hover:bg-[var(--surface-raised)]"><span className="font-medium">{item.title}</span><span className="ml-2 text-xs text-[var(--ink-muted)]">{new Date(item.createdAt).toLocaleString()}</span></a>)}</div>}
  </section>;
}
