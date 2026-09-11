"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { ALL_STAFF_PERMISSIONS, DEFAULT_TEAM_PERMISSIONS } from "@/lib/rbac";
import { statusLabel } from "@/lib/utils";
import type { StaffPermission } from "@/types";

type TeamUser = {
  uid: string;
  name: string;
  email: string;
  role: string;
  permissions?: StaffPermission[];
};

function PermissionCheckboxes({
  value,
  onChange,
  disabled,
}: {
  value: StaffPermission[];
  onChange: (next: StaffPermission[]) => void;
  disabled?: boolean;
}) {
  function toggle(perm: StaffPermission) {
    if (value.includes(perm)) onChange(value.filter((p) => p !== perm));
    else onChange([...value, perm]);
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ALL_STAFF_PERMISSIONS.map((perm) => (
        <label key={perm} className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={value.includes(perm)}
            onChange={() => toggle(perm)}
            disabled={disabled}
            className="rounded border-[var(--border)]"
          />
          <span className="font-mono text-xs">{perm}</span>
        </label>
      ))}
    </div>
  );
}

export default function TeamPage() {
  const { token, session } = useAuth();
  const isAdmin = session?.role === "admin";
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "team">("team");
  const [invitePerms, setInvitePerms] = useState<StaffPermission[]>([...DEFAULT_TEAM_PERMISSIONS]);
  const [saving, setSaving] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<StaffPermission[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    tempPassword: string;
    loginUrl: string;
    email: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ users: TeamUser[] }>("/api/users", { token });
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setError("");
    setMessage("");
    setInviteResult(null);
    try {
      const data = await apiFetch<{
        user: TeamUser;
        tempPassword: string;
        loginUrl: string;
      }>("/api/users/invite", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          permissions: role === "team" ? invitePerms : undefined,
        }),
      });
      setInviteResult({
        tempPassword: data.tempPassword,
        loginUrl: data.loginUrl,
        email: data.user.email,
      });
      setMessage(`Invited ${data.user.name}.`);
      setName("");
      setEmail("");
      setRole("team");
      setInvitePerms([...DEFAULT_TEAM_PERMISSIONS]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(u: TeamUser) {
    setEditingUid(u.uid);
    setEditPerms(
      u.permissions && u.permissions.length > 0
        ? [...u.permissions]
        : [...DEFAULT_TEAM_PERMISSIONS]
    );
    setMessage("");
    setError("");
  }

  async function savePermissions(uid: string) {
    setSavingPerms(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/users", {
        method: "PATCH",
        token,
        body: JSON.stringify({ uid, permissions: editPerms }),
      });
      setMessage("Permissions updated.");
      setEditingUid(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update permissions");
    } finally {
      setSavingPerms(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading team…</p>;
  }

  if (error && users.length === 0) {
    return (
      <EmptyState
        title="Couldn’t load team"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Team"
        description="Staff accounts with admin or team access."
      />

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <h2 className="font-[family-name:var(--font-display)] text-lg">Staff</h2>
          </div>
          {users.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-[var(--ink-muted)]">No team members yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {users.map((u) => (
                <li key={u.uid} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--ink)]">{u.name}</p>
                      <p className="truncate text-sm text-[var(--ink-muted)]">{u.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={u.role === "admin" ? "info" : "neutral"}>
                        {statusLabel(u.role)}
                      </Badge>
                      {isAdmin && u.role === "team" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => startEdit(u)}
                        >
                          Permissions
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {editingUid === u.uid ? (
                    <div className="mt-4 space-y-3 rounded-lg bg-[var(--surface-2)] p-3">
                      <PermissionCheckboxes value={editPerms} onChange={setEditPerms} />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingPerms}
                          onClick={() => void savePermissions(u.uid)}
                        >
                          {savingPerms ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={savingPerms}
                          onClick={() => setEditingUid(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : u.role === "team" && u.permissions && u.permissions.length > 0 ? (
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      {u.permissions.join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Invite teammate</h2>
          {!isAdmin ? (
            <p className="text-sm text-[var(--ink-muted)]">
              Only admins can invite new team members.
            </p>
          ) : (
            <form onSubmit={onInvite} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>Role</Label>
                <Dropdown
                  value={role}
                  onChange={(v) => setRole(v as "admin" | "team")}
                  options={[
                    { value: "team", label: "Team" },
                    { value: "admin", label: "Admin" },
                  ]}
                />
              </div>
              {role === "team" ? (
                <div>
                  <Label>Permissions</Label>
                  <div className="mt-2">
                    <PermissionCheckboxes value={invitePerms} onChange={setInvitePerms} />
                  </div>
                </div>
              ) : null}
              <Button type="submit" disabled={saving}>
                {saving ? "Sending…" : "Send invite"}
              </Button>
            </form>
          )}

          {inviteResult ? (
            <div className="mt-5 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <p>
                Invite sent to <strong>{inviteResult.email}</strong>
              </p>
              <p className="mt-2">
                <span className="text-[var(--ink-muted)]">Temp password:</span>{" "}
                <code className="font-semibold">{inviteResult.tempPassword}</code>
              </p>
              <p className="mt-1 break-all">
                <span className="text-[var(--ink-muted)]">Login:</span> {inviteResult.loginUrl}
              </p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
