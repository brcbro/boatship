"use client";

import { useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { ErrorText, SectionCard, SectionError, SectionSkeleton, StatusText, messageFor, useAccountResource } from "./shared";
import type { Account } from "./ProfileSection";

/*
 * Only controls with a working delivery path are shown (plan 4.3). Today that
 * is the staff digest flag; per-category work alerts and client digests ship
 * with their delivery enforcement, not before it.
 */
export function NotificationsSection() {
  const { session } = useAuth();
  const isStaff = session?.role === "admin" || session?.role === "team";
  const account = useAccountResource<{ user: Account }>("/api/account", { enabled: isStaff });
  const user = account.data?.user ?? null;

  const digestCard = !isStaff ? null : account.loading ? <SectionSkeleton title="Email digest" lines={1} /> : account.error || !user ? <SectionError title="Email digest" error={account.error || "Digest settings are unavailable."} onRetry={() => void account.reload()} /> : <DigestForm user={user} onSaved={(saved) => account.setData({ user: saved })} />;

  return (
    <>
      {digestCard}
      <SectionCard title="Always sent" description="Some messages are part of keeping your account safe and cannot be switched off.">
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
          <li>Invitation and password reset links you or an administrator request.</li>
          <li>Notices about changes to your password, sessions or account state, when Boatship sends them.</li>
        </ul>
      </SectionCard>
      <SectionCard title="In-app notifications" description="Mentions, assignments, due dates, reviews and messages reach you through the bell in the header.">
        <p className="text-sm leading-6 text-[var(--ink-muted)]">
          Per-category and per-channel choices, browser push and chat delivery are not available yet; they will appear here once Boatship can honour them for every alert it sends.
          {!isStaff ? " Client digests are not sent at all for now." : null}
        </p>
      </SectionCard>
    </>
  );
}

function DigestForm({ user, onSaved }: { user: Account; onSaved: (user: Account) => void }) {
  const [digestEnabled, setDigestEnabled] = useState(user.digestEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await apiFetch<{ user: Account }>("/api/account", { method: "PATCH", body: JSON.stringify({ digestEnabled }) });
      onSaved(response.user);
      setDigestEnabled(response.user.digestEnabled);
      setMessage(response.user.digestEnabled ? "You will be included in email digests." : "You will be left out of email digests.");
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Email digest" description="A summary of workspace updates sent by email.">
      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
        <input type="checkbox" checked={digestEnabled} onChange={(event) => setDigestEnabled(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
        <span>
          <span className="block text-sm font-medium text-[var(--ink)]">Include me in email digests</span>
          <span className="mt-1 block text-sm leading-6 text-[var(--ink-muted)]">Digests are sent when an administrator runs them. Boatship does not yet send them on a schedule, so this records your choice rather than promising a daily or weekly email.</span>
        </span>
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="mt-3"><StatusText>{message}</StatusText></div>
      <Button type="button" className="mt-4" disabled={busy || digestEnabled === user.digestEnabled} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button>
    </SectionCard>
  );
}
