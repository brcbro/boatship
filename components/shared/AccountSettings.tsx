"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Laptop2, UserRound } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, Input, Label, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { statusLabel } from "@/lib/utils";

type Account = {
  uid: string;
  email: string;
  name: string;
  role: string;
  clientId: string | null;
  createdAt: string;
  digestEnabled: boolean;
  hasPassword: boolean;
};

type AccountSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AccountSettings() {
  const { session, loading: authLoading, refresh } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsMessage, setSessionsMessage] = useState("");
  const [sessionsError, setSessionsError] = useState("");
  const userId = session?.uid;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [accountResponse, sessionsResponse] = await Promise.all([
        apiFetch<{ user: Account }>("/api/account"),
        apiFetch<{ sessions: AccountSession[] }>("/api/account/sessions"),
      ]);
      setAccount(accountResponse.user);
      setName(accountResponse.user.name);
      setDigestEnabled(accountResponse.user.digestEnabled);
      setSessions(sessionsResponse.sessions);
    } catch (error) {
      setLoadError(messageFor(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !userId) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, userId, load]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setProfileMessage("");
    if (name.trim().length < 2) { setProfileError("Name must be at least 2 characters."); return; }
    setProfileBusy(true);
    try {
      const response = await apiFetch<{ user: Account }>("/api/account", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), digestEnabled }),
      });
      setAccount(response.user);
      setName(response.user.name);
      setDigestEnabled(response.user.digestEnabled);
      setProfileMessage("Account details saved.");
      await refresh();
    } catch (error) {
      setProfileError(messageFor(error));
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword !== confirmPassword) { setPasswordError("The new passwords do not match."); return; }
    setPasswordBusy(true);
    try {
      await apiFetch<{ ok: boolean }>("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password changed successfully.");
    } catch (error) {
      setPasswordError(messageFor(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function signOutOtherDevices() {
    setSessionsError("");
    setSessionsMessage("");
    setSessionsBusy(true);
    try {
      const response = await apiFetch<{ ok: boolean; revoked: number }>("/api/account/sessions", { method: "DELETE" });
      const updated = await apiFetch<{ sessions: AccountSession[] }>("/api/account/sessions");
      setSessions(updated.sessions);
      setSessionsMessage(response.revoked === 1 ? "Signed out 1 other session." : `Signed out ${response.revoked} other sessions.`);
    } catch (error) {
      setSessionsError(messageFor(error));
    } finally {
      setSessionsBusy(false);
    }
  }

  if (authLoading || loading) return <div><PageHeader title="Account settings" description="Loading your account…" /><Card className="animate-pulse"><div className="h-5 w-44 rounded bg-[var(--surface-2)]" /><div className="mt-5 h-11 rounded bg-[var(--surface-2)]" /></Card></div>;
  if (loadError || !account) return <div><PageHeader title="Account settings" /><Card><p role="alert" className="text-sm text-[var(--danger)]">{loadError || "Account details are unavailable."}</p><Button type="button" className="mt-4" onClick={() => void load()}>Try again</Button></Card></div>;

  const otherSessionCount = sessions.filter((item) => !item.current).length;

  return (
    <div className="mx-auto max-w-4xl pb-6">
      <PageHeader title="Account settings" description="Manage your profile, password, and active sessions." />
      <div className="space-y-5">
        <Card className="p-5 sm:p-7">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--brand)]"><UserRound className="h-5 w-5" aria-hidden="true" /></div>
            <div><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Profile</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Your name is shown to people in your workspace.</p></div>
          </div>
          <form onSubmit={(event) => void saveProfile(event)} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div><Label htmlFor="account-name">Display name</Label><Input id="account-name" autoComplete="name" minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} required /></div>
              <div><Label htmlFor="account-email">Email address</Label><Input id="account-email" type="email" value={account.email} readOnly aria-describedby="account-email-note" /><p id="account-email-note" className="mt-1.5 text-xs text-[var(--ink-muted)]">Ask a workspace administrator if this needs to change.</p></div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] pt-5 text-sm text-[var(--ink-muted)]"><span>Role: <strong className="font-medium text-[var(--ink)]">{statusLabel(account.role)}</strong></span><span>Joined: <strong className="font-medium text-[var(--ink)]">{dateLabel(account.createdAt)}</strong></span></div>
            {account.role !== "client" ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-4"><input type="checkbox" checked={digestEnabled} onChange={(event) => setDigestEnabled(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand)]" /><span><span className="block text-sm font-medium text-[var(--ink)]">Email digest</span><span className="mt-1 block text-sm text-[var(--ink-muted)]">Receive a summary of workspace updates by email.</span></span></label> : null}
            {profileError ? <p role="alert" className="text-sm text-[var(--danger)]">{profileError}</p> : null}
            {profileMessage ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--success)]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{profileMessage}</p> : null}
            <Button type="submit" disabled={profileBusy || (name.trim() === account.name && digestEnabled === account.digestEnabled)}>{profileBusy ? "Saving…" : "Save changes"}</Button>
          </form>
        </Card>

        <Card className="p-5 sm:p-7">
          <div className="mb-6 flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--brand)]"><KeyRound className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Password</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Use a unique password for your Boatship account.</p></div></div>
          {account.hasPassword ? <form onSubmit={(event) => void changePassword(event)} className="space-y-4">
            <div><Label htmlFor="current-password">Current password</Label><Input id="current-password" type={showPasswords ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="new-password">New password</Label><Input id="new-password" type={showPasswords ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div><div><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type={showPasswords ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div></div>
            <button type="button" onClick={() => setShowPasswords((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm font-medium text-[var(--brand)] hover:underline">{showPasswords ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{showPasswords ? "Hide passwords" : "Show passwords"}</button>
            {passwordError ? <p role="alert" className="text-sm text-[var(--danger)]">{passwordError}</p> : null}
            {passwordMessage ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--success)]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{passwordMessage}</p> : null}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3"><Button type="submit" disabled={passwordBusy}>{passwordBusy ? "Changing…" : "Change password"}</Button><Link href="/login" className="inline-flex min-h-10 items-center text-sm font-medium text-[var(--brand)] hover:underline">Forgot your password?</Link></div>
          </form> : <div className="space-y-3"><p className="text-sm text-[var(--ink-muted)]">Set a password using the reset link sent to your email address.</p><Link href="/login" className="inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-strong)]">Open password reset</Link></div>}
        </Card>

        <Card className="p-5 sm:p-7">
          <div className="mb-5 flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--brand)]"><Laptop2 className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Signed-in sessions</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Review when your account was signed in.</p></div></div>
          {sessions.length ? <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">{sessions.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-medium text-[var(--ink)]">{item.current ? "Current session" : "Other session"}</span><span className="text-[var(--ink-muted)]">Signed in {dateLabel(item.createdAt)} · Expires {dateLabel(item.expiresAt)}</span></li>)}</ul> : <p className="text-sm text-[var(--ink-muted)]">No active sessions found.</p>}
          {sessionsError ? <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{sessionsError}</p> : null}
          {sessionsMessage ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--success)]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{sessionsMessage}</p> : null}
          <Button type="button" variant="secondary" className="mt-5" disabled={sessionsBusy || otherSessionCount === 0} onClick={() => void signOutOtherDevices()}>{sessionsBusy ? "Signing out…" : "Sign out other sessions"}</Button>
        </Card>
      </div>
    </div>
  );
}
