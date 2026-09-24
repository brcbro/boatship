# Implementation status and history

Last reviewed: 2026-09-25. This is a repository and release record, not continuous production health monitoring.

## Shipped in repository history

| Period / commits | What was added or changed |
| --- | --- |
| 2026-09-11 `2101e96` | Initial Boatship onboarding platform with staff and client portal applications. |
| 2026-09-12 `baf92e7`, `1545509` | Hodi onboarding command center, operations, queue, MCP/Git foundations and persistence migrations. |
| 2026-09-13 `922fa01` through `f634d95` | Cloudflare deployment path and Worker/Prisma fixes, faster store reads, Hodi workspace and automation reviews, marketing homepage. |
| 2026-09-18 to 2026-09-20 `71a482a` through `1a4fbf7` | Shared accounting ledger, improved portal workflows, realtime messaging and custom Worker deployment fix. |
| 2026-09-24 `dd47da8` | Client delivery workspace redesign and separate company product planning with relational product models and routes. |

The migration folder is the precise record of schema changes. Git commits are the precise record of when implementation entered the repository; this table is only a navigation aid.

## Current working tree at this review

There are uncommitted changes in auth, email, messaging, staff/client shells, client/team pages, and `README.md`, plus new `/account` pages, `/api/account` routes, and `components/shared/AccountSettings.tsx`. Treat that account work as **in progress** until it is reviewed, tested, and committed. Do not overwrite it while updating architecture documentation. Run `git status --short` before editing.

The enterprise-readiness work in this working tree restricts fixed demo users to local development and rejects existing fixed-password seed users in production; adds versioned, retrying writes to `StoreSnapshot`; adds database-backed rate limits for login, reset, invitations, MCP, and agent chat; rejects cross-origin cookie-authenticated API mutations; and restricts outbound webhooks to `WEBHOOK_ALLOWED_ORIGINS` with redacted secrets and no redirects. The two new migrations were applied to the configured production Neon database on 2026-09-25 before the Worker release. Webhook destinations still require operator approval; the existing `https://httpbin.org` destination is not allowlisted. A guarded private administrator provisioning process is documented. The production identity stores had zero known fixed seed users at inspection.

Verification for this working tree: `npx tsc --noEmit`, focused ESLint for the touched security/store paths, five focused security tests, and `npm run build` passed. The build emitted a Prisma WASM/Turbopack broad file-pattern performance warning.

The follow-up readiness work adds assigned-client authorization for team users across the main client resources and aggregate APIs, with server-only access helpers that read current assignments. It adds a guarded first-admin provisioning command, retires legacy account and local-import scripts that could overwrite the snapshot, and adds operations runbooks. Repository CI now runs tests, typecheck, scoped lint, build, and a critical-severity dependency audit, with weekly dependency update proposals. A generic 500 response includes a request ID while logging details server-side. The dependency audit still records open high-severity advisories in Prisma tooling.

Local verification on 2026-09-25: `npm test` (12 passing), `npm run lint`, `npm run typecheck`, `npm run build`, `npm run build:cloudflare`, `npx wrangler deploy --dry-run --outdir .wrangler/dry-run --config wrangler.production.toml`, and `git diff --check` passed. The build retained a Prisma WASM/Turbopack broad-pattern performance warning; OpenNext emitted Windows dependency-copy warnings, but the final Wrangler bundle compiled. No restore drill was available.

## 2026-09-25 production release

Commit `99ec6c6` was pushed to GitHub `master`, and Cloudflare deployed Worker version `b082fae3-cf38-4957-a68b-1d99472ab191` at `https://boatship.cohortix.in`. Live anonymous smoke checks returned 200 for `/`, `/login`, and `/api/auth/session` (`session: null`), and 401 for unauthenticated `/api/clients`. Authenticated staff/client workflows were not exercised because no production credentials were used. Cloudflare listed the core database, secrets master key, and realtime secrets by name without exposing their values. The existing `https://httpbin.org` webhook origin is not allowlisted, so outbound delivery to it remains blocked.

The first GitHub CI run for `99ec6c6` failed at `npm ci`: the lockfile omitted top-level `@emnapi/core` and `@emnapi/runtime` entries required on Linux. Commit `1176932` fixed the clean install; its CI run then reached typecheck and found that `custom-worker.ts` imports an OpenNext module generated only during packaging. The two generated-module import lines now have narrowly scoped TypeScript suppressions so a clean checkout can typecheck while Wrangler still bundles the Worker. Recheck CI after pushing this correction. The dependency metadata and type annotations do not change the deployed Worker behavior.

## Known boundaries and open work

- The confirmed enterprise access model is assigned clients for team members. Core APIs, exports, reminders, Hodi client context, and MCP access are guarded in the working tree. A staging authorization review across every integration and historical record remains necessary before rollout. The SSO provider and client-data recovery targets remain undecided.
- The product migration `20260924000000_add_products` and new migrations `20260924010000_version_store_snapshot` and `20260924020000_add_rate_limit_buckets` are applied in the configured production Neon database. On 2026-09-25 the latter two were applied with `npm run db:deploy` after explicit operator authorization. A read-only recheck confirmed both schema objects and migration records.
- A read-only production identity check found zero `seed_admin`/`seed_team` records in both `UserProfile` and the snapshot. Both stores contain six admin-role records; their individual access and need for privilege were not reviewed.
- Uniquely named synthetic rows in the production database verified that simultaneous snapshot updates elect one winner, a retry preserves both changes, and concurrent shared rate-limit upserts increment correctly. All synthetic rows were removed and a read-only check found zero leftovers. This did not test full authenticated Worker flows, backup restoration, or all cross-isolate behavior. Worker-local cached reads can be stale; the whole snapshot remains a scaling constraint.
- Product customers, subscriptions, revenue metrics, provider webhooks, product-specific Git evidence/validation, and scheduled product reminders are deferred by the [product plan](../docs/products-saas-integration-plan.md). Payment and analytics providers are undecided.
- Git webhook ingestion is implemented, but provider API synchronization is only a typed `not_configured` plan until real installation/token references are configured.
- Hodi automation is manually run and review-only; enabled rules do not imply a scheduler. Communication proposals do not directly deliver to external channels.
- The checked-in Cloudflare configuration has no Hyperdrive binding. Redis and realtime messaging secrets are optional/runtime-dependent; polling covers missing realtime support.
- The checked-in Wrangler files deploy a custom Worker. `README.md` now uses the same terminology.
- The repository includes `firestore.rules` and `storage.rules`, but the active persistence path documented by `lib/store.ts`, upload routes, and Prisma uses Neon. Verify any intended Firebase use before extending those rules.

## Change log for this architecture folder

- 2026-09-24: Created the baseline map from source, existing docs, migrations, and Git history. Added the maintenance instruction to `AGENTS.md`.
- 2026-09-24: Added an enterprise readiness audit and prioritized control backlog; no application behavior changed.
- 2026-09-24: Implemented the first code-level audit fixes (demo credentials, concurrent writes, shared throttles, cookie mutation origin checks, webhook egress and secret redaction), added migrations and focused security tests, and documented required deployment configuration. Production checks and broader P1 controls remain open.
- 2026-09-25: Added assigned-client server authorization, safer first-admin provisioning and retired unsafe import/account scripts, release/restore/incident runbooks, CI and dependency triage, and generic correlated server errors. Local tests, lint, typecheck, and build passed against the combined working tree; hosted deployment and recovery verification remain open.
- 2026-09-25: Applied the two additive readiness migrations to the operator-authorized production database; verified versioned concurrent writes and shared rate-limit upserts with isolated synthetic rows and confirmed cleanup. Built and dry-ran the Cloudflare Worker bundle. No restore drill was performed.
- 2026-09-25: Pushed the enterprise-readiness release, deployed the Cloudflare Worker, and passed anonymous live smoke checks. Recorded and corrected the Linux CI lockfile mismatch found after the first push.
