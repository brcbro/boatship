# Staff capability enforcement

Last reviewed: 2026-10-14. This describes repository behavior, not a deployed configuration.

## Source of truth and defaults

`lib/rbac.ts` defines the ten accepted `StaffPermission` keys. Admins have every staff capability. A team member's explicit list replaces the defaults; an explicit `[]` grants no staff capabilities. Only an omitted `permissions` property uses `DEFAULT_TEAM_PERMISSIONS` (`clients.view`, `clients.manage`, `documents.review`, `forms.review`, `analytics.view`). Malformed runtime lists fail closed; user-management writes reject malformed lists and unknown keys and remove duplicates. Client users never acquire staff capabilities through this list.

The authenticated API loads the user's current profile on each database session resolution. The session token's routing hints and the browser's cached session do not grant API access. `getSessionFromRequest` calls `requireStaffRequestPermissions`, covering both `requireSession` / `requireRoles` routes and direct callers such as task-manager approval endpoints. `getServerSession` currently has no application call sites; a future server-rendered data read must perform its own domain authorization.

`GET /api/users` preserves omitted permissions separately from an empty list and includes `effectivePermissions` for display. `PATCH /api/users` requires an explicit array. Team invitations use defaults when the property is omitted and preserve an explicit empty array. The Team editor shows no capabilities when a saved list is empty and explains that capability grants do not change role, assignment, or product membership. Admin-only team invitation and account-management role checks remain in place.

Relational `UserProfile.permissions` is a non-null `String[]`, so it cannot itself represent omission. Snapshot-to-profile normalization must materialize defaults for a team user whose historical snapshot omits the property. Existing relational empty lists cannot reveal whether their original intention was omitted defaults or a deliberate revocation; audit these profiles when rolling out this behavior. An empty relational list is treated as a deliberate denial from this release onward. No permission-inference migration is performed here.

## HTTP request policy

The policy compares the decoded pathname and HTTP method; query strings do not alter the required capability. `GET` and `HEAD` are reads. It adds capability checks; route-level role checks and current committed client-assignment checks still apply. Client portal requests bypass the staff-only policy and continue to require the existing own-account and task visibility checks.

| Routes / area | Required staff capability |
| --- | --- |
| `/api/clients/**`, `/api/engagements/**`, `/api/tasks/**`, `/api/vessels/**`, `/api/messages/**`, `/api/project-operations`, `/api/smart-lists/**`, `/api/reminders/**` | Reads: `clients.view`; mutations: `clients.manage`. |
| `/api/messages/live-ticket` | `clients.view`, including its ticket-issuance POST. |
| `/api/activity`, `/api/dashboard`, `/api/search`, `/api/onboarding-health`, `/api/reports/**` | `clients.view`. |
| `/api/documents/**` reads, including content and version retrieval | Either `clients.view` or `documents.review`. |
| `/api/documents/[id]` PATCH and `/api/documents/bulk` | `documents.review`. |
| Other document mutations, including upload / upload URL / record creation | `clients.manage`. |
| `/api/forms/**` reads / exports | Either `clients.view` or `forms.review`. |
| `/api/forms/[id]/review` | `forms.review`. |
| Other form mutations, including staff-assisted submission | `clients.manage`. |
| `/api/analytics` including CSV export | `analytics.view`. |
| `/api/integrations/**`, `/api/settings/secrets/**` | `integrations.manage`. |
| `/api/calendar` | Reads: `clients.view`; external event creation: `integrations.manage`. External calendar reads also require `integrations.manage` within the handler. |
| `/api/audit/**`, `/api/gdpr/**` | `audit.export`, in addition to any route-specific admin role requirement. |
| `/api/templates/**`, `/api/forms/templates/**` mutations | `templates.manage`; their existing admin-only writes remain admin-only. Reading template definitions retains the existing authenticated access. |
| `/api/users/**` mutations | `team.manage`; existing admin-only account/invitation writes remain admin-only. The authenticated staff directory retains its role check. |
| `/api/webhooks/**` excluding signed provider Git webhook ingestion | `webhooks.manage`; management remains admin-only. |
| `/api/notify`, `/api/digests`, `/api/automations` | Reads: `clients.view`; mutations: `clients.manage`. Dedicated admin-only actions retain their role checks. |
| `/api/git/**` | Reads: `clients.view`; mutations: `clients.manage`, in addition to repository and policy role checks. Provider-signed ingestion does not resolve a staff session and retains signature verification. |
| `/api/mcp/approvals` | Reads: `clients.view`; reviews: `clients.manage`, plus manager-review permission. |
| `/api/agent/chat`, `/api/agent/insights` | `clients.view`. |
| `/api/agent/communications/**`, `/api/hodi/queue/**` | Reads: `clients.view`; mutations: `clients.manage`. |

`clients.manage` does not implicitly grant `clients.view`, and either review capability authorizes its own resource reads independently. A reviewer still needs the current assignment to the resource's client. Accessing the complete staff client workspace separately requires `clients.view`; a review-only account can call its authorized resource endpoints without receiving the entire client account.

The current document detail PATCH is a staff review / metadata route and requires `documents.review`; file replacement through the upload flow uses `clients.manage`. Client uploads and replacements retain their own-account boundary. A capability grant does not authorize a team member to reassign a client to another staff member or to inspect an unassigned client.

## Hodi, integrations, and MCP

Hodi native client actions retain their existing `clients.manage` checks and revalidation at proposal execution. Client insights / chat require view capability. Connected Composio tools are supplied to Hodi only when `integrations.manage` is granted, and the agent configuration endpoint omits connections otherwise. Hodi Google Calendar preview and execution also check `integrations.manage`, closing the alternative route to calendar writes. Automatic server-side integration events from already-authorized client workflows remain domain workflow behavior; the configuration and manual external-tool controls use integration capability.

MCP bearer tokens use a separate identity-resolution path, so HTTP staff policy alone is insufficient. MCP identity resolution rejects reset-required users and unsafe production demo accounts, consistently with browser sessions. `lib/mcp-server.ts` checks the current token owner's staff permissions in addition to token scopes: client-context reads require `clients.view`; task writes and Git validation require `clients.manage`. `lib/mcp-context.ts` also suppresses client/task visibility without view permission, and `runApprovedTaskAction` rechecks management permission before creating an approval request or applying a write. MCP manager review uses `team.manage` alongside the request's client capability and current assignment. Token scopes and project-access restrictions remain additional requirements and cannot override staff revocation. Own MCP session history remains governed by its session-read scope.

## Boundaries and upkeep

An empty staff capability list does not disable sign-in, personal profile/password/session management, private notifications, the existing staff directory, template-definition reads, own Hodi history/proposals, or separately authorized product membership. Product write roles, accounting's admin role, MCP identity ownership, provider webhook signatures, and cron secrets remain independent authorization systems. Disabling an account or revoking all sessions is a separate operation.

The request policy is an explicit area map, not a default-deny registry for every future API. New API areas must add an appropriate policy or enforce their domain capability directly; the existence of `requireSession` alone does not protect a newly introduced capability. Domain functions invoked without an HTTP request must check permissions themselves. UI visibility is a convenience rather than authorization; a stale browser session can still show a control, but current server permissions deny its request.

`tests/permissions.test.mjs` verifies omitted versus empty defaults, permission-key validation, revocation before mutations, document/form independent review access, read versus management routes, analytics/integration/export capabilities, aggregate and realtime paths, encoded paths, client/admin behavior, and MCP token scope restrictions. Existing client-assignment tests verify that capability enforcement does not replace assignment or own-account boundaries. Live hosted role scenarios still require configured sessions and test accounts.
