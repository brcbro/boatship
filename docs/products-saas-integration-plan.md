# Company products and SaaS: integration plan

## Goal and working assumption

Add a **Products** section for software owned and operated by Boatship: internal tools, public SaaS products, and other company products. Product work is managed by Boatship staff and is independent of a client onboarding record. A customer of one of these products is not automatically a Boatship onboarding client.

This plan covers the section and its integration with the current app. Product management is implemented; billing and analytics provider data are deferred.

## Implementation status

The internal portfolio, product membership, roadmap, work items, release history, repository links, release-to-work links, recent activity, dashboard summary, workload counts, and assignment/release notifications are implemented in the app. The Prisma migration in `prisma/migrations/20260924000000_add_products/` must be applied to the target database before these routes are used there. Activity writes are best-effort and log failures after the primary change commits.

The user chose to keep payment and analytics provider integration for later. Product customer accounts, subscriptions, revenue metrics, provider webhooks, product-specific Git validation evidence, and scheduled overdue scans remain future work. The current Git evidence records attach to client task IDs; reusing them for product work requires a separate product-aware association and authorization path.

## Where it fits

- Add **Products** to the staff sidebar near **Projects**. The existing **Projects** page remains the client delivery view.
- `/products` shows a portfolio with each product's name, type, stage, owner, next milestone, open work, and release state. Provide filters for type, stage, and owner.
- `/products/new` creates a product. `/products/[id]` is its workspace with Overview, Roadmap, Work, Releases, Customers, Metrics, and Settings tabs. Show only tabs that have real data in the first release.
- The dashboard shows a compact product summary and a link to the portfolio; client onboarding counts stay separate.

## Core records

| Record | Purpose | Initial fields |
| --- | --- | --- |
| Product | Company-owned tool or SaaS | id, name, slug, type (`internal_tool`, `saas`, `other`), description, stage (`idea`, `building`, `beta`, `live`, `paused`, `retired`), ownerId, visibility, websiteUrl, createdAt, updatedAt |
| ProductMember | Staff access and responsibility | productId, userId, role (`owner`, `editor`, `viewer`) |
| ProductMilestone | Roadmap outcome | productId, title, description, targetDate, status, ownerId |
| ProductWorkItem | Internal execution | productId, milestoneId, title, description, status, priority, assigneeId, dueDate, dependency IDs, createdAt, updatedAt |
| ProductRelease | Version and rollout history | productId, version, environment, status, releasedAt, notes, repositoryId, commit SHA, deployment URL |
| ProductCustomer | Optional link to an organization using a product | productId, externalCustomerId or optional clientId, relationship/status; no automatic client onboarding access |

Use relational Prisma models for these records. The existing `StoreSnapshot` contains client-domain tasks and project operations; product records will need independent queries, filters, membership checks, and growth. Avoid creating a fake Client to satisfy `Task.clientId` or `ProjectMilestone.clientId`.

## Permissions and data boundaries

- Admin: create and archive products, assign owners, manage members, and view all product data.
- Team: see products where they are members; owners and editors manage roadmap, work, and releases; viewers read only.
- Client: no access to `/products` or `/api/products/*` by default. A future product customer portal needs separate authentication and authorization design.
- Enforce membership and role checks in every product API route. Sidebar visibility alone is insufficient.
- Product financial information and billing connections are admin only. Never expose provider credentials or raw webhook payloads to the browser.

## Integration with existing Boatship features

| Existing capability | Integration approach |
| --- | --- |
| Team and workload | Reuse `UserProfile` staff IDs for owner, members, and assignees. Extend workload queries to include product work with a clear source label. |
| Tasks and comments | Share presentation components where useful, but give product work its own product ID and API. Do not put product work into client tasks. |
| Calendar and reminders | Surface product milestone dates and assigned work alongside client items, with a product filter and product-specific notification links. |
| Git quality and repositories | Link products and releases to existing `GitRepositoryConnection`; reuse validation evidence when it applies to a product work item. Add product-aware association and authorization before exposing it. |
| Integrations | Use the existing per-staff connection model for optional GitHub, analytics, and billing connections. Show connection health per product. Start with read-only sync and explicit manual refresh. |
| Accounting | Keep the current rent/EMI/misc shared-expense ledger separate. Product revenue, subscriptions, and costs need their own records and reporting. |
| Hodi, search, and MCP | Add product resources only after product permissions can be enforced end to end. Include source labels in search and agent context so product and client records cannot be confused. |
| Activity and audit | Record product create/update, membership, release, and integration sync events with actor, product ID, and timestamp. |

## Delivery sequence

### Phase 1: useful internal portfolio

1. Add Prisma models and migration for Product, ProductMember, ProductMilestone, and ProductWorkItem. Add indexes for owner, stage, membership, and product/status.
2. Add typed domain functions and `/api/products` plus `/api/products/[id]` endpoints. Validate input and enforce product membership on reads and writes.
3. Add the Products sidebar item, portfolio, create/edit flow, and product overview with milestones and work items.
4. Add product events to notifications and product assignments to workload. Keep source labels visible.

**Done when:** an admin can create a product, assign an owner, and manage its roadmap; an assigned team member can manage permitted work; a client and an unrelated team member cannot read or change it.

### Phase 2: delivery and release tracking

1. Add ProductRelease and product-to-repository links.
2. Show linked repository, current version, release notes, deployment URL, and release history.
3. Connect existing Git evidence and validation to product work with a product-aware authorization path.
4. Add release and overdue milestone reminders.

**Done when:** a product owner can trace a release to its work and repository evidence without using a client project.

### Phase 3: SaaS operations

1. Add product customer/account mapping, plan and subscription snapshots, and product-specific metrics. Choose the payment and analytics providers before defining sync details.
2. Ingest provider webhooks with signature verification, idempotency keys, event logs, and reconciliation. Keep provider IDs separate from Boatship IDs.
3. Show active customers, trial/conversion, recurring revenue, churn, and support health only where source data is connected. Label sync time and missing data.
4. Add optional customer-to-Boatship-client links for cross-selling or services, with explicit permissions. No automatic conversion of a SaaS customer into an onboarding client.

**Done when:** product metrics reconcile with the chosen provider and a sync failure is visible without corrupting the product record.

## Decisions to settle before Phase 3

- Which products should be entered first, and are any of them internal-only?
- Which payment provider and analytics source are the systems of record for SaaS customers and revenue?
- Should team members see every product, or only products where they are assigned? This plan assumes assigned-only access.
- Does “manage” include product support tickets and feature requests in the first release? This plan starts with roadmap and internal work; support can follow as a separate product-domain workflow.
