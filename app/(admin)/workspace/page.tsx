"use client";

import { useEffect, useState } from "react";
import { Badge, Card, PageHeader } from "@/components/shared/ui";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";

type Workspace = { name: string; slug: string; policies: Array<{ id: string; name: string; description: string; allowedRoles: string[]; enabled: boolean }> };

export default function WorkspacePage() {
  const { token } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  useEffect(() => { void apiFetch<{ workspace: Workspace }>("/api/project-operations", { token }).then((data) => setWorkspace(data.workspace)); }, [token]);
  return <div className="space-y-6"><PageHeader title="Workspace" description="Organization and permission foundations for a multi-company Boatship workspace." /><Card><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{workspace?.name || "Boatship Workspace"}</p><p className="text-sm text-[var(--ink-muted)]">/{workspace?.slug || "boatship"} · role-based access is enforced by the API</p></div><Badge tone="success">Workspace active</Badge></div></Card><div className="grid gap-3 md:grid-cols-2">{(workspace?.policies || []).map((policy) => <Card key={policy.id}><div className="flex items-center justify-between gap-3"><p className="font-medium">{policy.name}</p><Badge tone={policy.enabled ? "success" : "neutral"}>{policy.enabled ? "Enabled" : "Disabled"}</Badge></div><p className="mt-2 text-sm text-[var(--ink-muted)]">{policy.description}</p><div className="mt-3 flex flex-wrap gap-1">{policy.allowedRoles.map((role) => <span key={role} className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--ink-muted)]">{role}</span>)}</div></Card>)}</div></div>;
}
