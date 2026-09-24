# Feature and integration map

Last reviewed: 2026-09-24. A page or route listed here means code exists, not that an external provider has been configured in every environment.

| Area | Behavior and source of truth | Main entry points |
| --- | --- | --- |
| Public site and login | Marketing home, sign-in, password setup/reset. Brand assets are in `public/brand/`. | `app/page.tsx`, `app/login/`, `app/api/auth/` |
| Staff dashboard and client pipeline | Staff overview, client creation/import/bulk edit, assignment, client workspace and progress. New clients can seed tasks from onboarding templates. | `app/(admin)/dashboard/`, `clients/`, `app/api/clients/`, `lib/store.ts` |
| Client portal | Client dashboard, own tasks, document uploads, forms, approvals, messages, and account view. | `app/(client)/portal/`, `components/client/ClientShell.tsx` |
| Tasks and evidence | Staff and client task workflows, subtasks/dependencies, comments, evidence, progress validation, definition-of-done, approvals, stale task view. | `app/(admin)/tasks/`, `components/shared/TaskBoard.tsx`, `app/api/tasks/` |
| Documents and forms | Database-backed uploads/versioning/review; dynamic form templates, submission and review, exports. | `app/api/documents/`, `app/api/forms/`, `app/(admin)/forms/` |
| Client operations | Client project milestones, schedules, approvals, health, weekly evidence reporting, calendar and reminders. These remain client-project concepts. | `lib/project-operations.ts`, `lib/onboarding-health.ts`, `lib/reminders.ts`, `app/api/project-operations/`, `calendar/`, `reminders/` |
| Communication and alerts | Persisted client/staff messages; realtime Durable Object with polling fallback; notifications, email, digests, webhooks. | `app/api/messages/`, `lib/realtime/`, `lib/notifications.ts`, `lib/email.ts`, `lib/webhooks.ts` |
| Products | Separate staff-owned product portfolio, membership, milestones, work items, releases, repository link, activity, notifications and workload counts. Product work is relational and is not placed in a fake client project. | `app/(admin)/products/`, `app/api/products/`, `lib/products.ts`, `types/product.ts` |
| Team and account | Staff users, invites and permissions; account profile/password/session management routes exist in the current working tree. | `app/(admin)/team/`, `app/(admin)/account/`, `app/api/users/`, `app/api/account/` |
| Accounting | Shared rent/EMI/misc expense ledger with splits and settlement status; independent of product revenue. | `app/(admin)/accounting/`, `app/api/accounting/`, `lib/accounting.ts` |
| Hodi | Staff assistant chat with Boatship context retrieval and optional Composio tools; queue and insight surfaces; approval-gated internal actions; communication drafts and automation review runs. | `app/(admin)/hodi/`, `app/(admin)/agent/`, `app/api/agent/`, `app/api/hodi/`, `lib/hodi-*.ts`, `lib/boatship-rag.ts` |
| External integrations | Per-user Composio namespace and saved connection ownership; Google Drive provisioning and other connected tools; encrypted user provider keys with server-wide fallbacks. | `app/(admin)/integrations/`, `app/api/integrations/`, `app/api/settings/secrets/`, `lib/composio.ts`, `lib/drive-provision.ts` |
| Git quality | GitHub/GitLab signed webhooks, task/repository links, evidence, definitions of done and validation. Provider API sync currently returns a plan until credentials are configured. | `app/api/git/`, `app/api/webhooks/git/`, `lib/git-*.ts`, [Git guide](../docs/git-integration.md) |
| MCP | Per-user Streamable HTTP endpoint with hashed token identities, scopes, project access, audit and controls. | `app/api/mcp/`, `lib/mcp-*.ts`, [client guide](../docs/mcp-clients.md) |
| Analytics and oversight | Dashboard metrics, workload, search, activity, audit export, GDPR export/delete, compliance and smart lists. | `app/(admin)/analytics/`, `workload/`, `compliance/`, `app/api/analytics/`, `search/`, `audit/`, `gdpr/` |

## External action boundaries

- Hodi automation rules persist their enabled state, but the web process does not schedule them. Current runs are initiated explicitly and save review results; they do not send external messages (`lib/hodi-automations.ts`).
- Hodi communication approval records a handoff-ready draft; direct delivery requires a verified channel contract (`prisma/schema.prisma`, `lib/hodi-communications.ts`).
- Composio, Resend, LLM, Redis, and Drive behavior depends on valid configuration and connected accounts. Missing optional services should be understood from route responses and feature code, not inferred from the presence of UI alone.
- Product payment/customer/analytics integrations and product-specific Git validation are deferred; [product plan](../docs/products-saas-integration-plan.md) gives the intended boundaries.
