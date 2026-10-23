"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/shared/ui";
import type { AccessGroup } from "@/lib/account-access";
import { accountSectionHref } from "./AccountLayout";
import { Facts, SectionCard, SectionError, SectionSkeleton, useAccountResource } from "./shared";

type AccessSummary = {
  role: "admin" | "team" | "client";
  status: string;
  permissionsExplicit: boolean | null;
  capabilities: AccessGroup[];
  effective: string[];
  assignedClients: Array<{ id: string; name: string; companyName: string }> | null;
  products: Array<{ id: string; name: string; role: string }> | null;
  organization: { id: string; name: string; companyName: string; assignedTeamMemberName: string | null } | null;
};

/** Explains effective access (plan 4.5). It is not an editor: nothing here changes a permission. */
export function AccessSection({ basePath }: { basePath: "/account" | "/portal/account" }) {
  const access = useAccountResource<{ access: AccessSummary }>("/api/account/access");
  const [showKeys, setShowKeys] = useState(false);

  if (access.loading) return <SectionSkeleton title="My access" lines={3} />;
  if (access.error || !access.data) return <SectionError title="My access" error={access.error || "Your access summary is unavailable."} onRetry={() => void access.reload()} />;
  const summary = access.data.access;
  const requestLink = <Link href={accountSectionHref(basePath, "privacy")} className="font-medium text-[var(--brand)] hover:underline">Request a change</Link>;

  if (summary.role === "client") {
    return (
      <>
        <SectionCard title="Your organization" description="You see and contribute to the work Boatship shares with your organization.">
          {summary.organization ? (
            <Facts items={[
              { label: "Organization", value: summary.organization.companyName || summary.organization.name },
              { label: "Your Boatship contact", value: summary.organization.assignedTeamMemberName ?? "Not assigned yet" },
            ]} />
          ) : <p className="text-sm text-[var(--ink-muted)]">Your account is not linked to an organization yet. Ask your Boatship contact.</p>}
        </SectionCard>
        <SectionCard title="What you can do" description="Every person in your organization currently has the same portal access.">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>Read tasks, documents, forms, engagements and messages shared with your organization.</li>
            <li>Complete assigned tasks, upload documents, submit forms and send messages.</li>
            <li>Approve requests that Boatship sends to your organization for a decision.</li>
          </ul>
          <p className="mt-4 text-sm text-[var(--ink-muted)]">Separate viewer and administrator levels for client organizations are not available yet. {requestLink} if someone else at your organization needs access.</p>
        </SectionCard>
      </>
    );
  }

  const isAdmin = summary.role === "admin";
  return (
    <>
      <SectionCard
        title={isAdmin ? "Boatship administrator" : "Team member"}
        description={isAdmin ? "Administrators hold every staff capability, can open every client and product, and manage team accounts and workspace settings." : summary.permissionsExplicit ? "Your capabilities were set individually by an administrator." : "You have the default capabilities for team members; an administrator can change them."}
      >
        {!isAdmin && summary.effective.length === 0 ? (
          <p className="rounded-[var(--radius-md)] bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">You currently have no client capabilities. You can still use your account, any products you are a member of, and request access below.</p>
        ) : null}
        <div className="mt-4 space-y-4">
          {summary.capabilities.map((group) => (
            <div key={group.key}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{group.label}</h3>
              <ul className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {group.capabilities.map((capability) => (
                  <li key={capability.key} className="flex gap-3 py-2.5">
                    <span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${capability.granted ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-faint)]"}`}>
                      {capability.granted ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink)]">
                        {capability.label}
                        <span className="sr-only">{capability.granted ? " (granted)" : " (not granted)"}</span>
                        {capability.adminOnly ? <Badge tone="neutral">Admin role required</Badge> : null}
                        {showKeys ? <code className="rounded bg-[var(--surface-2)] px-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">{capability.key}</code> : null}
                      </p>
                      <p className="text-sm leading-6 text-[var(--ink-muted)]">{capability.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button type="button" className="mt-4 min-h-10 text-sm font-medium text-[var(--brand)] hover:underline" aria-expanded={showKeys} onClick={() => setShowKeys((value) => !value)}>{showKeys ? "Hide capability keys" : "Show capability keys"}</button>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
          {isAdmin ? "Administrator access is granted by role. There is no separate owner level; keep at least one other active administrator before stepping down." : <>Client capabilities only apply to clients assigned to you. Managing does not include viewing on its own, some controls need the administrator role, and products use their own roles. Only an administrator can change this; {requestLink}.</>}
        </p>
      </SectionCard>

      {summary.assignedClients ? (
        <SectionCard title="Assigned clients" description="Client work you can open, subject to the capabilities above.">
          {summary.assignedClients.length ? (
            <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {summary.assignedClients.map((client) => (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium text-[var(--ink)]">{client.companyName || client.name}</span>
                  {summary.effective.includes("clients.view") ? <Link href={`/clients/${client.id}`} prefetch={false} className="text-[var(--brand)] hover:underline">Open</Link> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ink-muted)]">No client work is assigned to you. An administrator assigns clients from each client record.</p>}
        </SectionCard>
      ) : null}

      <SectionCard title="Products" description={isAdmin ? "Administrators can open every product. Memberships listed here are held in your own right." : "Product roles are separate from client capabilities and are managed by an administrator on each product."}>
        {summary.products?.length ? (
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {summary.products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <Link href={`/products/${product.id}`} prefetch={false} className="font-medium text-[var(--ink)] hover:underline">{product.name}</Link>
                <Badge tone={product.role === "owner" ? "brand" : "neutral"}>{product.role.charAt(0).toUpperCase() + product.role.slice(1)}</Badge>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--ink-muted)]">You are not a member of any product.</p>}
      </SectionCard>

      <SectionCard title="Connections and tools" description="Integrations and MCP keys keep their own controls.">
        <p className="text-sm leading-6 text-[var(--ink-muted)]">
          <Link href="/integrations" prefetch={false} className="font-medium text-[var(--brand)] hover:underline">Integrations</Link> and <Link href="/mcp" prefetch={false} className="font-medium text-[var(--brand)] hover:underline">MCP access</Link> show what you have connected. Having an account does not by itself allow connecting a provider or running a tool.
        </p>
      </SectionCard>
    </>
  );
}
