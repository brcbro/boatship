"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader, Button, Card, Input, Badge } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

type Identity = { publicId: string; userId: string; status: string; scopes: string[]; lastUsedAt: string | null; createdAt: string; projectAccess: Array<{ projectId: string; accessLevel: string }> };

export default function McpPage() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState("");
  const [scopes, setScopes] = useState("tasks:read,projects:read,context:read,session:read");

  async function load() { const result = await apiFetch<{ identities: Identity[] }>("/api/mcp/identities"); setIdentities(result.identities); }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy(true); setMessage("");
    try { const result = await apiFetch<{ token: string; identity: Identity }>("/api/mcp/identities", { method: "POST", body: JSON.stringify({ userId: userId || undefined, scopes: scopes.split(",").map((item) => item.trim()).filter(Boolean) }) }); setToken(result.token); setMessage("Token created. Copy it now; it will not be shown again."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create token"); } finally { setBusy(false); }
  }
  async function action(publicId: string, actionName?: string) {
    setBusy(true); setMessage("");
    try { const result = await apiFetch<{ token?: string }>("/api/mcp/identities", { method: actionName ? "PATCH" : "DELETE", body: actionName ? JSON.stringify({ publicId, action: actionName }) : undefined }); if (result.token) setToken(result.token); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); } finally { setBusy(false); }
  }
  function copy(value: string) { void navigator.clipboard.writeText(value); setMessage("Copied to clipboard"); }

  return <div className="space-y-8">
    <PageHeader title="MCP credentials" description="Issue least-privilege credentials for Codex, Claude Code, Cursor, and other MCP clients." actions={<Button onClick={() => void load()} variant="secondary"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} />
    <Card className="max-w-3xl space-y-5 p-6">
      <div className="flex items-center gap-3"><KeyRound className="h-5 w-5 text-[var(--accent)]" /><div><h2 className="font-semibold">Create credential</h2><p className="text-sm text-[var(--ink-muted)]">Tokens are hashed in Neon and shown only once.</p></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><Input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="User ID (blank = you)" aria-label="User ID" /><Input value={scopes} onChange={(event) => setScopes(event.target.value)} placeholder="Comma-separated scopes" aria-label="Scopes" /></div>
      <Button onClick={() => void create()} disabled={busy}>Create credential</Button>
      {token ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><p className="mb-2 font-semibold text-amber-950">Copy this token now</p><div className="flex flex-wrap gap-2"><code className="min-w-0 flex-1 overflow-auto rounded-lg bg-white p-2 text-xs text-amber-950">{token}</code><Button size="sm" onClick={() => copy(token)}><Copy className="mr-2 h-4 w-4" />Copy token</Button><Button size="sm" variant="secondary" onClick={() => copy(JSON.stringify({ mcpServers: { boatship: { url: `${window.location.origin}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2))}><Copy className="mr-2 h-4 w-4" />Copy config</Button></div></div> : null}
      {message ? <p className="text-sm text-[var(--ink-muted)]" role="status">{message}</p> : null}
    </Card>
    <Card className="overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-semibold">Active identities</h2><p className="text-sm text-[var(--ink-muted)]">Revoke lost devices or regenerate a credential without exposing the secret.</p></div><div className="divide-y divide-[var(--border)]">{identities.length ? identities.map((identity) => <div key={identity.publicId} className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><code className="truncate text-sm">{identity.publicId}</code><Badge tone={identity.status === "active" ? "success" : "neutral"}>{identity.status}</Badge></div><p className="mt-1 text-xs text-[var(--ink-muted)]">User {identity.userId} · Last used {identity.lastUsedAt ? new Date(identity.lastUsedAt).toLocaleString() : "Never"}</p><div className="mt-2 flex flex-wrap gap-1">{identity.scopes.map((scope) => <span key={scope} className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--ink-muted)]">{scope}</span>)}</div></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="secondary" onClick={() => void action(identity.publicId, "regenerate")} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />Regenerate</Button><Button size="sm" variant="secondary" onClick={() => void action(identity.publicId)} disabled={busy || identity.status !== "active"}><Trash2 className="mr-1 h-4 w-4" />Revoke</Button></div></div>) : <div className="p-8 text-center text-sm text-[var(--ink-muted)]"><ShieldCheck className="mx-auto mb-2 h-6 w-6" />No MCP credentials yet.</div>}</div></Card>
  </div>;
}
