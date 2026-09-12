"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";

type Approval = { id: string; subject: string; description: string; kind: string; status: "pending" | "approved" | "changes_requested"; createdAt: string };

export default function PortalApprovalsPage() {
  const { session, token } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState("");
  const clientId = session?.clientId;
  const load = useCallback(async () => { if (!clientId) return; try { const data = await apiFetch<{ approvals: Approval[] }>(`/api/project-operations?clientId=${encodeURIComponent(clientId)}`, { token }); setApprovals(data.approvals); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load approvals"); } }, [clientId, token]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  async function review(approvalId: string, status: "approved" | "changes_requested") { await apiFetch("/api/project-operations", { method: "POST", token, body: JSON.stringify({ action: "approval-review", approvalId, status }) }); await load(); }
  return <div className="space-y-6"><PageHeader title="Approvals" description="Review documents, designs, and release decisions requested by your delivery team." />{error ? <p className="text-sm text-red-700">{error}</p> : null}{approvals.length === 0 ? <EmptyState title="No approvals waiting" description="Your team will post approval requests here when a decision is needed." /> : <div className="space-y-3">{approvals.map((approval) => <Card key={approval.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="font-medium">{approval.subject}</p><Badge tone={approval.status === "approved" ? "success" : approval.status === "changes_requested" ? "warning" : "neutral"}>{approval.status.replace("_", " ")}</Badge></div><p className="mt-2 text-sm text-[var(--ink-muted)]">{approval.description || `Requested ${approval.kind} approval.`}</p><p className="mt-2 text-xs text-[var(--ink-muted)]">Requested {new Date(approval.createdAt).toLocaleDateString()}</p></div>{approval.status === "pending" ? <div className="flex gap-2"><Button onClick={() => void review(approval.id, "changes_requested")} variant="secondary">Request changes</Button><Button onClick={() => void review(approval.id, "approved")}>Approve</Button></div> : null}</div></Card>)}</div>}</div>;
}
