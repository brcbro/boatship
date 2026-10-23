"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Hint, Input, Label, Modal } from "@/components/shared/ui";
import { apiFetch, setStoredToken } from "@/lib/api-client";
import { formatAccountDateTime } from "@/lib/account-preferences";
import { ErrorText, SectionCard, SectionError, SectionSkeleton, StatusText, messageFor, useAccountResource, useDisplayPreferences } from "./shared";

type AccountSession = { id: string; createdAt: string; expiresAt: string; current: boolean };
type SecurityEvent = { id: string; action: string; label: string; result: "ok" | "denied" | "failed"; by: "you" | "administrator" | "staff" | "system"; createdAt: string };
type EventsPage = { events: SecurityEvent[]; nextBefore: string | null };

export function SecuritySection() {
  return (
    <>
      <PasswordCard />
      <SessionsCard />
      <ActivityCard />
    </>
  );
}

function PasswordCard() {
  const account = useAccountResource<{ user: { hasPassword: boolean } }>("/api/account");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (account.loading) return <SectionSkeleton title="Password" lines={2} />;
  if (account.error || !account.data) return <SectionError title="Password" error={account.error || "Password settings are unavailable."} onRetry={() => void account.reload()} />;

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword.length < 8 || newPassword.length > 128) { setError("The new password must be between 8 and 128 characters."); return; }
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await apiFetch<{ ok: boolean; token?: string; signedOut?: number }>("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      // The server replaced this session with a new one; keep the bearer copy in step with the cookie.
      if (result.token) setStoredToken(result.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(result.signedOut ? `Password changed. ${result.signedOut === 1 ? "1 other session was" : `${result.signedOut} other sessions were`} signed out; this device stays signed in.` : "Password changed. This device stays signed in.");
      window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED));
    } catch (changeError) {
      setError(messageFor(changeError));
    } finally {
      setBusy(false);
    }
  }

  if (!account.data.user.hasPassword) {
    return (
      <SectionCard title="Password" description="This account has no password yet.">
        <p className="text-sm text-[var(--ink-muted)]">Set one with the link in your invitation email, or request a new link from the sign-in page.</p>
        <Link href="/login" className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-md)] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] hover:bg-[var(--brand-strong)]">Open the sign-in page</Link>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Password" description="Changing your password signs out every other session. This device keeps a fresh session.">
      <form onSubmit={(event) => void change(event)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="current-password">Current password</Label>
          <Input id="current-password" type={show ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-describedby="new-password-hint" required />
            <Hint id="new-password-hint">8 to 128 characters. Use something you do not use elsewhere.</Hint>
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </div>
        </div>
        <button type="button" onClick={() => setShow((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-sm)] text-sm font-medium text-[var(--brand)] hover:underline">
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {show ? "Hide passwords" : "Show passwords"}
        </button>
        <ErrorText>{error}</ErrorText>
        <StatusText>{message}</StatusText>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? "Changing…" : "Change password"}</Button>
          <Link href="/login" className="inline-flex min-h-10 items-center text-sm font-medium text-[var(--brand)] hover:underline">Forgot your password?</Link>
        </div>
      </form>
    </SectionCard>
  );
}

/** Password changes and revocations tell the session list to reload. */
const SESSIONS_CHANGED = "boatship:account-sessions";

function SessionsCard() {
  const { logout } = useAuth();
  const sessions = useAccountResource<{ sessions: AccountSession[] }>("/api/account/sessions");
  const preferences = useDisplayPreferences();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"others" | "current" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const list = sessions.data?.sessions ?? [];
  const others = list.filter((item) => !item.current);
  const current = list.find((item) => item.current) ?? null;

  const reloadSessions = sessions.reload;
  useSessionsChanged(useCallback(() => void reloadSessions(), [reloadSessions]));

  if (sessions.loading) return <SectionSkeleton title="Signed-in sessions" lines={2} />;
  if (sessions.error || !sessions.data) return <SectionError title="Signed-in sessions" error={sessions.error || "Your sessions are unavailable."} onRetry={() => void sessions.reload()} />;

  async function revokeOne(item: AccountSession) {
    setError("");
    setMessage("");
    setBusyId(item.id);
    try {
      const result = await apiFetch<{ ok: boolean; signedOut: boolean }>(`/api/account/sessions/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (result.signedOut) { await logout(); return; }
      sessions.setData((data) => (data ? { sessions: data.sessions.filter((entry) => entry.id !== item.id) } : data));
      setMessage("Signed out that session.");
    } catch (revokeError) {
      // The row stays until the server confirms; nothing is removed optimistically.
      setError(messageFor(revokeError));
      await sessions.reload();
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function revokeOthers() {
    setError("");
    setMessage("");
    setBusyId("others");
    try {
      const response = await apiFetch<{ ok: boolean; revoked: number }>("/api/account/sessions", { method: "DELETE" });
      await sessions.reload();
      setMessage(response.revoked === 1 ? "Signed out 1 other session." : `Signed out ${response.revoked} other sessions.`);
    } catch (revokeError) {
      setError(messageFor(revokeError));
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  return (
    <SectionCard title="Signed-in sessions" description="Every place your account is signed in. Device and location details are not recorded, so sessions are listed by when they started.">
      {list.length ? (
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {list.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  {item.current ? "This device" : "Another device"}
                  {item.current ? <Badge tone="success">Current</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">Signed in {formatAccountDateTime(item.createdAt, preferences)} · Expires {formatAccountDateTime(item.expiresAt, preferences)}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={busyId !== null} onClick={() => (item.current ? setConfirm("current") : void revokeOne(item))}>
                {busyId === item.id ? "Signing out…" : item.current ? "Sign out this device" : "Sign out"}
              </Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--ink-muted)]">No active sessions found.</p>}
      <ErrorText>{error ? <span className="mt-4 block">{error}</span> : null}</ErrorText>
      <div className="mt-4"><StatusText>{message}</StatusText></div>
      <Button type="button" variant="secondary" className="mt-5" disabled={busyId !== null || others.length === 0} onClick={() => setConfirm("others")}>
        {busyId === "others" ? "Signing out…" : "Sign out other sessions"}
      </Button>

      <Modal
        open={confirm === "others"}
        onClose={() => setConfirm(null)}
        title="Sign out other sessions?"
        description={`${others.length === 1 ? "1 other session" : `${others.length} other sessions`} will be signed out immediately. This device stays signed in.`}
        footer={<><Button type="button" variant="secondary" onClick={() => setConfirm(null)}>Keep them</Button><Button type="button" variant="danger" onClick={() => void revokeOthers()}>Sign out others</Button></>}
      >
        <p className="text-sm text-[var(--ink-muted)]">Anyone using those sessions will need to sign in again. If you did not start one of them, change your password as well.</p>
      </Modal>
      <Modal
        open={confirm === "current"}
        onClose={() => setConfirm(null)}
        title="Sign out this device?"
        description="You will return to the sign-in page. Other sessions are not affected."
        footer={<><Button type="button" variant="secondary" onClick={() => setConfirm(null)}>Stay signed in</Button><Button type="button" variant="danger" onClick={() => current && void revokeOne(current)}>Sign out</Button></>}
      >
        <p className="text-sm text-[var(--ink-muted)]">Unsaved edits on other account pages will be lost.</p>
      </Modal>
    </SectionCard>
  );
}

function useSessionsChanged(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(SESSIONS_CHANGED, onChange);
    return () => window.removeEventListener(SESSIONS_CHANGED, onChange);
  }, [onChange]);
}

function ActivityCard() {
  const preferences = useDisplayPreferences();
  const page = useAccountResource<EventsPage>("/api/account/security-events?limit=10");
  const [older, setOlder] = useState<SecurityEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  if (page.loading) return <SectionSkeleton title="Recent security activity" lines={2} />;
  if (page.error || !page.data) return <SectionError title="Recent security activity" error={page.error || "Security activity is unavailable."} onRetry={() => void page.reload()} />;

  const events = [...page.data.events, ...older];
  const cursor = nextBefore === undefined ? page.data.nextBefore : nextBefore;

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const more = await apiFetch<EventsPage>(`/api/account/security-events?limit=20&before=${encodeURIComponent(cursor)}`);
      setOlder((current) => [...current, ...more.events]);
      setNextBefore(more.nextBefore);
    } catch (loadError) {
      setMoreError(messageFor(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SectionCard title="Recent security activity" description="Changes to your credentials, sessions and account state. Client work activity is shown elsewhere.">
      {events.length ? (
        <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">{event.label}</p>
                <p className="text-xs text-[var(--ink-muted)]">By {event.by === "you" ? "you" : event.by === "administrator" ? "an administrator" : event.by === "staff" ? "Boatship staff" : "Boatship"}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                {event.result !== "ok" ? <Badge tone={event.result === "denied" ? "warning" : "danger"}>{event.result === "denied" ? "Refused" : "Failed"}</Badge> : null}
                <time dateTime={event.createdAt}>{formatAccountDateTime(event.createdAt, preferences)}</time>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-[var(--ink-muted)]">No security activity has been recorded for your account yet.</p>}
      <ErrorText>{moreError}</ErrorText>
      {cursor ? <Button type="button" variant="secondary" size="sm" className="mt-4" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Show older activity"}</Button> : null}
    </SectionCard>
  );
}
