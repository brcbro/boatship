import type { StaffPermission } from "@/types";

/*
 * Human-readable explanation of staff capabilities for the "My access"
 * section (plan 4.5). This describes effective access; it grants nothing and
 * must stay in step with `staffRequestPermissionRules` in lib/rbac.ts.
 */

export type CapabilityGroupKey = "client_work" | "reviews" | "reporting" | "configuration";

export type CapabilityDescription = {
  key: StaffPermission;
  label: string;
  /** What the key allows, including limits the key alone does not convey. */
  detail: string;
  /** Routes behind this key also require the admin role. */
  adminOnly?: boolean;
};

export const CAPABILITY_GROUPS: ReadonlyArray<{ key: CapabilityGroupKey; label: string; capabilities: readonly CapabilityDescription[] }> = [
  {
    key: "client_work",
    label: "Client work",
    capabilities: [
      { key: "clients.view", label: "View client work", detail: "Read clients, engagements, tasks, messages and reports for the clients assigned to you." },
      { key: "clients.manage", label: "Manage client work", detail: "Create and change tasks, engagements, messages and client records for assigned clients. It does not include viewing on its own." },
    ],
  },
  {
    key: "reviews",
    label: "Reviews",
    capabilities: [
      { key: "documents.review", label: "Review documents", detail: "Approve or reject uploaded documents for assigned clients, without needing general client access." },
      { key: "forms.review", label: "Review forms", detail: "Review form submissions for assigned clients, without needing general client access." },
    ],
  },
  {
    key: "reporting",
    label: "Reporting",
    capabilities: [
      { key: "analytics.view", label: "View analytics", detail: "Open the analytics screens and reporting endpoints." },
      { key: "audit.export", label: "Export audit and client data", detail: "Download audit trails and client data exports." },
    ],
  },
  {
    key: "configuration",
    label: "Configuration",
    capabilities: [
      { key: "team.manage", label: "Team management", detail: "Takes part in manager approval reviews. Inviting and changing staff accounts still requires the administrator role." },
      { key: "integrations.manage", label: "Manage integrations", detail: "Connect providers, manage delivery jobs and workspace secrets." },
      { key: "templates.manage", label: "Manage templates", detail: "Create and publish service and form templates.", adminOnly: true },
      { key: "webhooks.manage", label: "Manage webhooks", detail: "Configure outbound webhooks.", adminOnly: true },
    ],
  },
];

export type AccessGroup = {
  key: CapabilityGroupKey;
  label: string;
  capabilities: Array<CapabilityDescription & { granted: boolean }>;
};

/** Every group with each capability marked granted or not, so the UI can show what is missing as well as what is held. */
export function describeCapabilities(effective: readonly StaffPermission[]): AccessGroup[] {
  const held = new Set(effective);
  return CAPABILITY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    capabilities: group.capabilities.map((capability) => ({ ...capability, granted: held.has(capability.key) })),
  }));
}
