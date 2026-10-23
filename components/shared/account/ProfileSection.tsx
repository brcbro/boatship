"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Hint, Input, Label } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatAccountDateTime, type AccountPreferences } from "@/lib/account-preferences";
import { accountSectionHref } from "./AccountLayout";
import { ErrorText, Facts, SectionCard, SectionError, SectionSkeleton, StatusText, messageFor, useAccountResource, useDisplayPreferences, useUnsavedWarning } from "./shared";

export type Account = {
  uid: string;
  email: string;
  name: string;
  role: "admin" | "team" | "client";
  clientId: string | null;
  createdAt: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  digestEnabled: boolean;
  hasPassword: boolean;
};

const ROLE_LABEL: Record<Account["role"], string> = { admin: "Administrator", team: "Team member", client: "Client" };
const STATUS_TONE: Record<Account["status"], "success" | "warning" | "danger" | "neutral"> = { active: "success", invited: "warning", suspended: "danger", deactivated: "neutral" };

export function ProfileSection({ basePath }: { basePath: "/account" | "/portal/account" }) {
  const account = useAccountResource<{ user: Account }>("/api/account");
  const preferences = useDisplayPreferences();
  const user = account.data?.user ?? null;

  if (account.loading) return <SectionSkeleton title="Profile" lines={3} />;
  if (account.error || !user) return <SectionError title="Profile" error={account.error || "Your account details are unavailable."} onRetry={() => void account.reload()} />;

  return (
    <>
      <NameForm user={user} onSaved={(saved) => account.setData({ user: saved })} />
      <AccountFacts user={user} basePath={basePath} preferences={preferences} />
    </>
  );
}

/** Starts from the loaded name, so no effect has to copy server state into the field. */
function NameForm({ user, onSaved }: { user: Account; onSaved: (user: Account) => void }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty = name.trim() !== user.name;
  useUnsavedWarning(dirty);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) { setError("Your name must be between 2 and 100 characters."); return; }
    setBusy(true);
    try {
      const response = await apiFetch<{ user: Account }>("/api/account", { method: "PATCH", body: JSON.stringify({ name: trimmed }) });
      onSaved(response.user);
      setName(response.user.name);
      setMessage("Name saved.");
      // The shell shows the name from the session; refresh it so both agree at once.
      await refresh();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setBusy(false);
    }
  }

  return (
      <SectionCard title="Who you are" description="Your display name appears on messages, comments and work history. Past entries keep the name they were written with.">
        <form onSubmit={(event) => void save(event)} className="space-y-5" noValidate>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="account-name">Display name</Label>
              <Input id="account-name" autoComplete="name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "account-name-error" : undefined} required />
            </div>
            <div>
              <Label htmlFor="account-email">Login email</Label>
              <Input id="account-email" type="email" value={user.email} readOnly aria-describedby="account-email-note" />
              <Hint id="account-email-note">Changing the login email is not available yet. If you lose access to this address, use the password reset on the sign-in page while you still can.</Hint>
            </div>
          </div>
          <ErrorText id="account-name-error">{error}</ErrorText>
          <StatusText>{message}</StatusText>
          <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save changes"}</Button>
        </form>
      </SectionCard>
  );
}

function AccountFacts({ user, basePath, preferences }: { user: Account; basePath: "/account" | "/portal/account"; preferences: AccountPreferences | null }) {
  return (
      <SectionCard title="Account" description="These details are set by Boatship and cannot be changed here.">
        <Facts
          items={[
            { label: "Role", value: ROLE_LABEL[user.role] },
            { label: "Account state", value: <Badge tone={STATUS_TONE[user.status]}>{user.status.charAt(0).toUpperCase() + user.status.slice(1)}</Badge> },
            { label: "Joined", value: formatAccountDateTime(user.createdAt, preferences, "date") },
            ...(user.role === "client"
              ? [{ label: "Organization", value: <Link href={accountSectionHref(basePath, "access")} className="text-[var(--brand)] hover:underline">See your organization under My access</Link> }]
              : []),
          ]}
        />
        <p className="mt-4 text-sm text-[var(--ink-muted)]">
          Your role, client association and capabilities are managed by a Boatship administrator. <Link href={accountSectionHref(basePath, "access")} className="font-medium text-[var(--brand)] hover:underline">See what you can do</Link> or <Link href={accountSectionHref(basePath, "privacy")} className="font-medium text-[var(--brand)] hover:underline">request a change</Link>.
        </p>
      </SectionCard>
  );
}
