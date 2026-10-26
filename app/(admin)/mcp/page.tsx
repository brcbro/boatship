"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { PageHeader, Button, Card, ConfirmDialog, Dropdown, Hint, Input, Badge, Label } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type Identity = { publicId: string; userId: string; status: string; scopes: string[]; lastUsedAt: string | null; createdAt: string; projectAccess: Array<{ projectId: string; accessLevel: string }> };
type StaffUser = { uid: string; name: string; email: string; role: string };
type PendingAction = { identity: Identity; kind: "regenerate" | "revoke" };

export default function McpPage() {
  const { session } = useAuth();
  const isAdmin = session?.role === "admin";
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [userId, setUserId] = useState("");
  const [scopes, setScopes] = useState("tasks:read,projects:read,context:read,session:read");
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await apiFetch<{ identities: Identity[] }>("/api/mcp/identities");
      setIdentities(result.identities);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load MCP credentials");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Only admins may issue a credential for someone else, so only they get the staff picker.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    apiFetch<{ users: StaffUser[] }>("/api/users")
      .then((result) => { if (!cancelled) setStaff(result.users); })
      .catch(() => { if (!cancelled) setStaff([]); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  function staffName(uid: string) {
    if (uid === session?.uid) return "you";
    const user = staff.find((item) => item.uid === uid);
    return user ? `${user.name} (${user.email})` : uid;
  }

  async function create() {
    setBusy(true); setMessage(""); setActionError("");
    try {
      const result = await apiFetch<{ token: string; identity: Identity }>("/api/mcp/identities", { method: "POST", body: JSON.stringify({ userId: userId || undefined, scopes: scopes.split(",").map((item) => item.trim()).filter(Boolean) }) });
      setToken(result.token);
      setMessage("Token created. Copy it now; it will not be shown again.");
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to create token");
    } finally {
      setBusy(false);
    }
  }

  async function runPending() {
    if (!pending) return;
    const { identity, kind } = pending;
    setBusy(true); setMessage(""); setActionError("");
    try {
      // PATCH without action "regenerate" revokes. (The old DELETE call sent no
      // publicId, which the route reads from the query string, so it always failed.)
      const result = await apiFetch<{ token?: string }>("/api/mcp/identities", {
        method: "PATCH",
        body: JSON.stringify({ publicId: identity.publicId, action: kind }),
      });
      if (result.token) setToken(result.token);
      setMessage(kind === "regenerate" ? `Regenerated ${identity.publicId}. The old token no longer works; copy the new one now.` : `Revoked ${identity.publicId}.`);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  function copy(value: string) { void navigator.clipboard.writeText(value); setMessage("Copied to clipboard"); }

  return <div className="space-y-8">
    <PageHeader title="MCP credentials" description="Issue least-privilege credentials for Codex, Claude Code, Cursor, and other MCP clients." actions={<Button onClick={() => void load()} variant="secondary" disabled={loading}><RefreshCw className={loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />Refresh</Button>} />
    <Card className="max-w-3xl space-y-5 p-6">
      <div className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-[var(--brand)]" /><div><h2 className="font-semibold">Create credential</h2><p className="text-sm text-[var(--ink-muted)]">Boatship stores only a hash of each token. The token itself is shown once.</p></div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {isAdmin ? (
          <div>
            <Dropdown
              label="Issue for"
              value={userId}
              onChange={setUserId}
              options={[{ value: "", label: "Me" }, ...staff.filter((user) => user.uid !== session?.uid).map((user) => ({ value: user.uid, label: `${user.name} (${user.email})` }))]}
            />
          </div>
        ) : (
          <div>
            <Label>Issue for</Label>
            <p className="min-h-10 py-2 text-sm text-[var(--ink)]">You</p>
            <Hint>Only an admin can issue a credential for another team member.</Hint>
          </div>
        )}
        <div>
          <Label htmlFor="mcp-scopes">Scopes</Label>
          <Input id="mcp-scopes" value={scopes} onChange={(event) => setScopes(event.target.value)} placeholder="Comma-separated scopes" />
        </div>
      </div>
      <Button onClick={() => void create()} disabled={busy}>Create credential</Button>
      {token ? <div className="rounded-[var(--radius-lg)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm"><p className="mb-2 font-semibold text-[var(--warning)]">Copy this token now</p><div className="flex flex-wrap gap-2"><code className="min-w-0 flex-1 overflow-auto rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-2 text-xs text-[var(--warning)]">{token}</code><Button size="sm" onClick={() => copy(token)}><Copy className="mr-2 h-4 w-4" />Copy token</Button><Button size="sm" variant="secondary" onClick={() => copy(JSON.stringify({ mcpServers: { boatship: { url: `${window.location.origin}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2))}><Copy className="mr-2 h-4 w-4" />Copy config</Button></div></div> : null}
      {message ? <p className="text-sm text-[var(--ink-muted)]" role="status">{message}</p> : null}
      {actionError ? <p className="text-sm text-[var(--danger)]" role="alert">{actionError}</p> : null}
    </Card>
    <Card className="overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-semibold">Active identities</h2><p className="text-sm text-[var(--ink-muted)]">Revoke lost devices or regenerate a credential without exposing the secret.</p></div><div className="divide-y divide-[var(--border)]">
      {loading && !identities.length ? <p role="status" className="p-8 text-center text-sm text-[var(--ink-muted)]">Loading credentials…</p>
        : loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-[var(--danger)]"><span>Couldn’t load credentials: {loadError}</span><Button size="sm" variant="secondary" onClick={() => void load()}>Try again</Button></div>
        : identities.length ? identities.map((identity) => <div key={identity.publicId} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><code className="truncate text-sm">{identity.publicId}</code><Badge tone={identity.status === "active" ? "success" : "neutral"}>{identity.status}</Badge></div><p className="mt-1 text-xs text-[var(--ink-muted)]">For {staffName(identity.userId)} · Last used {identity.lastUsedAt ? new Date(identity.lastUsedAt).toLocaleString() : "Never"}</p><div className="mt-2 flex flex-wrap gap-1">{identity.scopes.map((scope) => <span key={scope} className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{scope}</span>)}</div></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="secondary" onClick={() => setPending({ identity, kind: "regenerate" })} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />Regenerate</Button><Button size="sm" variant="secondary" onClick={() => setPending({ identity, kind: "revoke" })} disabled={busy || identity.status !== "active"}><Trash2 className="mr-1 h-4 w-4" />Revoke</Button></div></div>)
        : <div className="p-8 text-center text-sm text-[var(--ink-muted)]"><ShieldCheck className="mx-auto mb-2 h-6 w-6" />No MCP credentials yet.</div>}
    </div></Card>
    <ConfirmDialog
      open={!!pending}
      title={pending?.kind === "regenerate" ? "Regenerate this credential?" : "Revoke this credential?"}
      description={pending?.kind === "regenerate"
        ? "The current token stops working at once. Every MCP client using it must be given the new token."
        : "MCP clients using this token lose access at once. This cannot be undone."}
      tone="danger"
      confirmLabel={pending?.kind === "regenerate" ? "Regenerate" : "Revoke"}
      busyLabel="Working…"
      busy={busy}
      onCancel={() => setPending(null)}
      onConfirm={() => void runPending()}
    >
      {pending ? <p className="text-sm text-[var(--ink)]"><code>{pending.identity.publicId}</code> for {staffName(pending.identity.userId)}, scopes {pending.identity.scopes.join(", ") || "none"}.</p> : null}
    </ConfirmDialog>
  </div>;
}
