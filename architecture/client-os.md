# Client OS architecture record

Last reviewed: 2026-09-27. This records repository behavior; deployment of the new migration is separate.

## Account and engagement

The existing `Client` in `StoreSnapshot` remains the account identity and retains its ID, primary contact, assigned team member, portal users, tags, and historical records. Its `status` and `pipelineStage` still describe the original onboarding workflow for compatibility. They are labeled as legacy onboarding controls in the staff workspace.

`Engagement` is a relational record for a bounded onboarding, project, or ongoing service under one client. It stores name, type, status (`planned`, `active`, `paused`, `completed`, `cancelled`), owner, dates, and completion time. A client can have multiple engagements. Work tasks remain in `StoreSnapshot`; new tasks carry `engagementId`. Old tasks without it resolve to `onboarding_<clientId>`. Progress is computed from tasks in that engagement, not all client tasks.

The additive migration `20260927000000_add_client_engagements` creates `Engagement` and `ClientContact`, then backfills one stable legacy onboarding engagement and primary directory contact per existing client. New client creation ensures those rows. The migration does not rewrite old task IDs or snapshot data. Apply it before serving routes that query either table. Do not apply it to production until the release is approved and a recovery point exists.

Historical onboarding completion time is approximated from the last client update because the old client record has no dedicated completion timestamp. Dashboard and analytics label the resulting duration accordingly.

## Routes and access

- `GET/POST /api/clients/[id]/engagements` lists or creates engagements. `GET/PATCH /api/engagements/[id]` reads or changes one. Client users may read their own engagements; staff may create/change only for currently assigned clients (admins can access all).
- `GET /api/tasks?clientId=...&engagementId=...` filters tasks to an engagement; client users still receive only client-facing tasks. Task creation accepts a same-client `engagementId`. Closed engagement task workflow mutations are rejected; historical comments remain available.
- `GET/POST /api/clients/[id]/contacts` and `PATCH/DELETE /api/clients/[id]/contacts/[contactId]` manage a contact directory. Only authorized staff mutate it. Directory roles describe contact responsibility; they do **not** grant portal login or change API permissions. Portal access still comes from a client user account with `UserProfile.clientId` and existing invitation flow.
- Staff account and client portal pages list engagements and show work in engagement context. The portal keeps account-level forms, documents, approvals, and messages while existing task-linked items remain reachable.

## Current boundaries

The snapshot remains the source of truth for tasks, forms, documents, messages, and project operations. Only tasks carry an engagement ID in this release; existing milestones, approvals, documents, and forms are client-scoped or task-linked. The current account owner is still one assigned team member, and a portal user still belongs to one client account. Contact directory roles are not authorization roles. Hodi, MCP, webhooks, and exports continue to operate on client-scoped records; they do not create or expose engagement-specific resources yet.

The existing onboarding health and completion automation use only legacy onboarding tasks. Dashboard and analytics report active engagement counts from relational rows. A future move of other high-volume work out of `StoreSnapshot` should be driven by measured read/write load and a separate migration, not by this account split alone.

File-only local demo mode synthesizes the legacy onboarding engagement and primary contact so existing pages and tasks still load. Creating additional engagements or contacts in that mode returns 501; those writes require the relational database.
