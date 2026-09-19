"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MessageSquareText, RotateCcw } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";

type Approval = {
  id: string;
  subject: string;
  description: string;
  kind: string;
  status: "pending" | "approved" | "changes_requested";
  createdAt: string;
};

function approvalTone(status: Approval["status"]): "neutral" | "success" | "warning" {
  if (status === "approved") return "success";
  if (status === "changes_requested") return "warning";
  return "neutral";
}

function approvalLabel(status: Approval["status"]) {
  if (status === "changes_requested") return "Changes requested";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function PortalApprovalsPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const clientId = session?.clientId;

  const load = useCallback(async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ approvals: Approval[] }>(
        `/api/project-operations?clientId=${encodeURIComponent(clientId)}`,
        { token }
      );
      setApprovals(data.approvals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t load your approvals. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  async function review(approvalId: string, status: "approved" | "changes_requested") {
    setBusyId(approvalId);
    setError("");
    try {
      await apiFetch("/api/project-operations", {
        method: "POST",
        token,
        body: JSON.stringify({ action: "approval-review", approvalId, status }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t save your decision. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = approvals.filter((approval) => approval.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Review decisions from your delivery team. Approve when you’re ready, or request changes with a note in Messages."
      />

      {error ? (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>Try again</Button>
        </div>
      ) : null}

      {loading ? (
        <Card className="py-12 text-center text-sm text-[var(--ink-muted)]">Loading approval requests…</Card>
      ) : !clientId ? (
        <EmptyState title="No client linked" description="Your account is not connected to a client workspace." />
      ) : approvals.length === 0 ? (
        <EmptyState
          title="Nothing needs your approval"
          description="When your team needs a decision on a design, document, or release, it will appear here."
        />
      ) : (
        <section className="space-y-4" aria-label="Approval requests">
          <p className="text-sm text-[var(--ink-muted)]">{pendingCount} decision{pendingCount === 1 ? "" : "s"} waiting for you</p>
          {approvals.map((approval) => {
            const pending = approval.status === "pending";
            const saving = busyId === approval.id;
            return (
              <Card key={approval.id} className="p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">{approval.subject}</h2>
                      <Badge tone={approvalTone(approval.status)}>{approvalLabel(approval.status)}</Badge>
                    </div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">{approval.description || `Your team requested a ${approval.kind} decision.`}</p>
                    <p className="mt-3 text-xs font-medium text-[var(--ink-muted)]">Requested {formatDate(approval.createdAt)}</p>
                  </div>
                  {pending ? (
                    <div className="grid shrink-0 gap-2 sm:flex">
                      <Button type="button" variant="secondary" disabled={saving} onClick={() => void review(approval.id, "changes_requested")}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Request changes
                      </Button>
                      <Button type="button" disabled={saving} onClick={() => void review(approval.id, "approved")}>
                        <Check className="h-4 w-4" aria-hidden="true" /> {saving ? "Saving…" : "Approve"}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {pending ? <p className="mt-5 flex items-center gap-2 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--ink-muted)]"><MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" /> Need to explain a requested change? Send the team a message after choosing this option.</p> : null}
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
