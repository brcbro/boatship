"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Hint, Label, Select, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatAccountDateTime } from "@/lib/account-preferences";
import { ErrorText, SectionCard, SectionError, SectionSkeleton, StatusText, messageFor, useAccountResource, useDisplayPreferences } from "./shared";

type RequestKind = "access" | "export" | "deactivation";
type AccountRequest = { id: string; kind: RequestKind; status: "open" | "approved" | "declined" | "completed" | "withdrawn"; reason: string | null; decisionNote: string | null; createdAt: string; updatedAt: string; decidedAt: string | null };

const KIND_LABEL: Record<RequestKind, string> = { access: "More access", export: "A copy of my account data", deactivation: "Deactivate my account" };
const STATUS_TONE: Record<AccountRequest["status"], "info" | "success" | "danger" | "neutral"> = { open: "info", approved: "success", completed: "success", declined: "danger", withdrawn: "neutral" };

/*
 * Plan 4.6: explains what can be requested and records the request for an
 * administrator. Nothing here exports, deletes or deactivates by itself, and
 * no support address or processing deadline is invented.
 */
export function PrivacySection() {
  const { session } = useAuth();
  const isStaff = session?.role === "admin" || session?.role === "team";
  const preferences = useDisplayPreferences();
  const requests = useAccountResource<{ requests: AccountRequest[] }>("/api/account/requests");
  const [kind, setKind] = useState<RequestKind | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!kind) { setError("Choose what you want to request."); return; }
    setBusy(true);
    try {
      const response = await apiFetch<{ request: AccountRequest }>("/api/account/requests", { method: "POST", body: JSON.stringify({ kind, reason: reason.trim() || null }) });
      requests.setData((data) => ({ requests: [response.request, ...(data?.requests ?? [])] }));
      setKind("");
      setReason("");
      setMessage("Request recorded. An administrator will review it.");
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard title="What you can request" description="Requests go to Boatship administrators, who review them by hand. Nothing happens automatically and there is no fixed processing time.">
        <dl className="space-y-4 text-sm leading-6">
          <div>
            <dt className="font-semibold text-[var(--ink)]">More access</dt>
            <dd className="text-[var(--ink-muted)]">{isStaff ? "Ask for a capability, a client assignment or a product role. Say what you need and why; the request grants nothing until an administrator changes your access." : "Ask for someone else at your organization to be invited, or for a change to what you can see."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">A copy of your account data</dt>
            <dd className="text-[var(--ink-muted)]">Your profile, preferences and the security activity about your account. Shared project records, other people&apos;s information, credentials and internal notes are not part of a personal copy; organization data has its own process with your Boatship contact.</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Deactivate your account</dt>
            <dd className="text-[var(--ink-muted)]">Stops your sign-in after an administrator reviews and hands over your work. It does not delete {isStaff ? "clients, completed work or evidence" : "your organization, submitted work or messages"}, and it is not a data erasure; erasure is handled separately.</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="Make a request" id="requests">
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="request-kind">What do you need?</Label>
              <Select id="request-kind" value={kind} onChange={(event) => setKind(event.target.value as RequestKind | "")} required>
                <option value="">Choose…</option>
                {(Object.keys(KIND_LABEL) as RequestKind[]).map((value) => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="request-reason">Details <span className="font-normal text-[var(--ink-muted)]">(optional)</span></Label>
            <Textarea id="request-reason" rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} aria-describedby="request-reason-hint" />
            <Hint id="request-reason-hint">For access requests, name the client, product or capability. Do not include passwords.</Hint>
          </div>
          <ErrorText>{error}</ErrorText>
          <StatusText>{message}</StatusText>
          <Button type="submit" disabled={busy || !kind}>{busy ? "Sending…" : "Send request"}</Button>
        </form>
      </SectionCard>

      {requests.loading ? <SectionSkeleton title="Your requests" lines={1} /> : requests.error || !requests.data ? <SectionError title="Your requests" error={requests.error || "Your requests are unavailable."} onRetry={() => void requests.reload()} /> : (
        <SectionCard title="Your requests" description="Every request you have made and where it stands.">
          {requests.data.requests.length ? (
            <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {requests.data.requests.map((request) => (
                <li key={request.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--ink)]">{KIND_LABEL[request.kind]}</p>
                    <Badge tone={STATUS_TONE[request.status]}>{request.status.charAt(0).toUpperCase() + request.status.slice(1)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Sent {formatAccountDateTime(request.createdAt, preferences)}{request.decidedAt ? ` · Decided ${formatAccountDateTime(request.decidedAt, preferences)}` : ""}</p>
                  {request.reason ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--ink-muted)]">{request.reason}</p> : null}
                  {request.decisionNote ? <p className="mt-1 text-sm text-[var(--ink)]">Reply: {request.decisionNote}</p> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ink-muted)]">You have not made any requests.</p>}
        </SectionCard>
      )}
    </>
  );
}
