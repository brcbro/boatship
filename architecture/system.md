# System design and request flow

Last reviewed: 2026-10-15. October audit changes are implemented locally and await deployment.

## Runtime and entry points

- Next.js `16.4.1`, React 19, TypeScript, Tailwind CSS. Pages use the App Router. Staff and portal route groups have separate shell components; their group names do not appear in URLs.
- `proxy.ts` handles coarse browser routing: the public home stays accessible; unauthenticated protected page visits go to `/login`; client and staff pages redirect to the correct home. API routes do their own database-backed session and permission checks. The proxy's decoded token payload is not the final authorization decision.
- `app/api/**/route.ts` contains HTTP handlers. `lib/api.ts` standardizes success/error responses. Most handlers declare the Node.js runtime; the Cloudflare adapter packages them for Workers.
- The public Cloudflare Worker forwards ordinary HTTP and scheduled Next.js requests to four bounded `AppRuntime` Durable Object instances. `lib/runtime-routing.ts` hashes the session cookie/bearer header, or an anonymous route key, into `app-0` through `app-3`; raw credentials are never instance names. The Durable Object runs the OpenNext handler outside the public Free-plan invocation's CPU ceiling. The existing `MessageRoom` still handles live sockets. Request-scoped snapshot reuse replaces the former shared cache, and database conditional writes coordinate instances. The existing `v2` class migration and binding are reused; no additional Durable Object migration is needed. Sharding is implemented locally and needs hosted traffic measurement.
- `app/layout.tsx`, `app/globals.css`, the two route-group layouts, and `components/*Shell.tsx` define the global UI frame. `components/shared/AuthProvider.tsx` manages browser auth state.

## Persistence

**Primary database:** Neon PostgreSQL through Prisma (`lib/prisma.ts`). `DATABASE_URL` uses the Neon HTTP adapter by default. An optional real Cloudflare Hyperdrive binding switches to Prisma's PostgreSQL adapter. `DIRECT_URL` is used by Prisma schema and migrations. Prisma clients are constructed per call for Worker request isolation. Loopback PostgreSQL in local Node development uses a shared bounded eight-connection transport pool; this permits isolated integration tests without hosted credentials and does not share Worker network objects.

**Client delivery store:** `lib/store.ts` exposes `DataStore`. Client metadata, tasks, templates, document metadata, form templates/submissions, activity, comments, messages, webhooks, smart lists, agent chat history, vessels, integration runs, and project operations remain in a `StoreSnapshot` JSON record. `PrismaStore` reads a fresh snapshot before each mutation and conditionally updates its version with a single-row statement supported by Neon's HTTP adapter, retrying conflicting writes. `handleApi` and binary retrieval create an AsyncLocalStorage scope; one request can reuse its store, while subsequent requests start fresh. Successful writes refresh that request's snapshot and advance optional Redis generation. Concurrent document replacements append the actual current file inside the retry; native form submission commits answers, identity, activity, and webhook intent together. The whole metadata snapshot remains a write-contention constraint. Explicit demo mode retains `.data/store.json`; fixed demo users are seeded only there.

**Relational tables:** `AuthSession`, `UserProfile`, and `NotificationRecord` support hot identity and notification reads. `RateLimitBucket` stores shared quotas; `StoreSnapshot.version` supports conditional writes. `DocumentContent` owns each file and stores its bytes in the row or, when the `DOCUMENT_FILES` R2 binding is present, in R2 under `objectKey` ([document storage](document-storage.md)). It stores file bytes separately in Neon; `IntegrationJob` stores leased provider work separately. The October migration creates these tables and moves legacy current/history base64 into byte records. Other relational models hold provider secrets/connections, MCP, Git, Hodi, and product work. See `prisma/schema.prisma` for exact columns and relations.

**Client OS split:** `Engagement` and `ClientContact` are relational records added by `20260927000000_add_client_engagements`. `Client` remains in `StoreSnapshot`; its old status and pipeline fields remain the original onboarding state. New tasks can carry an engagement ID in the snapshot, while old tasks resolve to a deterministic legacy onboarding engagement. Contact directory roles do not grant application access. See [client-os.md](client-os.md) for migration and route boundaries.

**Neon HTTP write boundary:** The deployed configuration has no Hyperdrive binding, so Prisma's Neon HTTP adapter cannot start transactions. Session/secret deletion, notification bulk updates, Hodi proposal state changes, and repository deactivation use single parameterized SQL statements. `lib/product-persistence.ts` uses data-changing PostgreSQL CTEs for product/member, release/work-link, owner-transfer, and member-removal writes that must commit together; MCP identity plus project access uses the same pattern. New relational writes must avoid Prisma `$transaction`, `updateMany`, `deleteMany`, and nested relation writes on this adapter unless a transaction-capable binding is configured and verified.

**Optional cache:** `lib/redis-cache.ts` uses Upstash-compatible Redis REST for selected read endpoints. It is best effort and keyed by a generation advanced after datastore writes. Redis failure falls back to Neon. Do not assume it invalidates independent relational product writes; those queries have their own behavior.

**Documents:** `app/api/documents/upload-url` returns a logical client-scoped database path. `/api/documents/upload` validates strict base64, a 10 MiB limit, filename, extension, MIME, signature, ownership, task, and open engagement before saving a separate `DocumentContent` byte record and retrying its metadata commit. All metadata responses omit bytes and internal content IDs. Authenticated `GET /api/documents/[id]/content` retrieves current or zero-based historical content, with private/no-store headers and byte-range support. Metadata-only POST and PATCH file replacement are rejected so they cannot bypass upload validation. Preview/download/replacement use this flow. The user chose Neon storage; no R2 integration is added. See [document-storage.md](document-storage.md) for migration and failure boundaries. Malware scanning and retention remain open.

## Identity and authorization

1. `POST /api/auth/login` verifies a stored scrypt password hash and creates a random session token. A hash of the token, user ID, and expiry are stored in `AuthSession`. The browser receives an HTTP-only cookie; bearer tokens are also accepted by API session resolution.
2. `lib/auth.ts` verifies the token against the database, checks expiry, reloads the current user, and rejects users required to reset their password or still using known fixed demo credentials in production. `proxy.ts` supplies page redirects based on the token's embedded routing hint and rejects cross-origin cookie-authenticated API mutations. API routes remain responsible for authorization.
3. API session resolution applies `lib/rbac.ts` method/area capability policy in addition to route roles and `lib/client-access.ts` ownership checks. Explicit empty staff grants deny capabilities; only omitted grants use defaults. Read, manage, document review, form review, integration, and export capabilities are independent. MCP additionally checks the current token owner's permissions and reset state. Team access remains restricted to current committed client assignment; client users remain scoped to their own account. Product roles remain separate. See [permissions.md](permissions.md).
4. Invitations and password resets use one-time setup/reset links and `lib/email.ts`. Hosted delivery uses the Zoho India CPaaS email API with `ZEPTOMAIL_API_KEY` and a verified general `ZEPTOMAIL_FROM`, or Resend with `RESEND_API_KEY` and `RESEND_FROM`. Zoho takes priority when configured; missing or onboarding-specific sender configuration throws instead of reporting a demo send. The shared mail function selects Boatship, Boatship Team, or Boatship Updates as the display name by message type. Client and team invitations have separate content; task mail uses engagement context. Admins can send a token-free team welcome message for controlled one-time use via the rate-limited `team_welcome` action in `/api/notify`; the Team page has no permanent welcome control. User and account management endpoints are under `/api/users`, `/api/clients/*/invite`, and `/api/account`.
5. User-entered provider secrets are encrypted by `lib/user-secrets.ts` before persistence. `BOATSHIP_SECRETS_MASTER_KEY` must be retained for decryption. MCP tokens are shown once and stored hashed; MCP scopes and project access are verified separately.
6. Login, password reset, invitation, MCP, and agent chat requests consume shared database rate limits in `lib/rate-limit.ts`. Explicit local-only demo mode uses process-local buckets so it can run without a database. Outbound webhooks require a configured exact HTTPS origin in `WEBHOOK_ALLOWED_ORIGINS`; redirects are rejected and list/detail responses redact signing secrets.

Development-only proxy handling recognizes Next's canonical localhost URL when the actual browser Host is another loopback address, while retaining exact Origin, port, and fetch-site checks. Hosted URL-origin validation is unchanged. This permits local cookie-authenticated sign-out/submission at 127.0.0.1 without disabling the CSRF boundary.

## Typical client delivery flow

```mermaid
sequenceDiagram
  participant Staff
  participant API as API routes
  participant Store as DataStore
  participant DB as Neon
  participant Client
  Staff->>API: Create client
  API->>Store: createClient / seed tasks from template
  Store->>DB: Persist snapshot
  Staff->>API: Invite client
  API->>Client: Password setup email
  Client->>API: Sign in, complete tasks, submit forms and documents
  API->>Store: Update records and activity
  Store->>DB: Persist snapshot
  Staff->>API: Review progress, documents and approvals
```

Task work may carry subtasks, dependencies, comments, evidence, definition-of-done, Git links, validation, and manager approval. Client project operations add milestones, schedules, and approvals through `lib/project-operations.ts`. Notifications and activity connect changes back to staff and clients. Product overdue work and milestones create member-scoped in-app notifications on weekday Worker cron runs, with deterministic IDs preventing duplicate notifications for the same item and day.

The account can contain multiple engagements. Tasks, forms, documents, messages, milestones, and approvals can carry context. Explicit `engagementId=account` selects account-wide resources; a real engagement selects its records, with account-wide inclusion only when requested. Old task-linked files/forms inherit their task's legacy context; unlinked records remain account-wide. Completed/cancelled contexts retain history and reject new uploads, form submissions/reviews, messages, and approval decisions. Portal and intake drafts use scoped 24-hour sessionStorage with honest storage-failure feedback. See [forms-validation-drafts.md](forms-validation-drafts.md) and [interface-audit-remediation.md](interface-audit-remediation.md).

## Hodi creation flow

`/api/agent/chat` gives the model a `propose_boatship_action` tool alongside optional connected-app tools. The proposal tool validates the requested action, checks current staff permissions and client/product access, and stores a short-lived proposal with its payload hash and preview. The chat UI reads the signed-in user's pending proposals and offers Approve or Decline. Approval sends the original payload and single-use token to `/api/agent/actions/execute`; `lib/hodi-actions.ts` claims the proposal atomically, revalidates it, then dispatches to the relevant domain creation module. This path also supports existing direct proposal APIs. A successful action returns its created record and, where applicable, a page link. Calendar creation calls Google Calendar through the signed-in user's Composio connection. The UI offers Continue plan after execution and supplies created record IDs to the next chat turn. Each dependent step needs its own proposal; there is no cross-service transaction or automatic scheduling.

## Live messages

`/api/messages` is the persisted source of truth. After save, the route publishes to a client-specific `MessageRoom`. The Worker verifies a short-lived server-issued ticket before socket upgrade. Context is filtered by both HTTP reads and browser realtime/polling state; changing context clears stale results and names the compose destination. The Worker needs `MESSAGE_ROOM` and `MESSAGE_REALTIME_SECRET`; local Next development uses polling when realtime is unavailable.

## Webhook delivery and health

Event routes await webhook intent in the snapshot. Native form submission includes that intent in its domain commit; other writes/enqueues remain separate. Secret-protected drains lease, back off, and stop after ten attempts; receiver delivery IDs are stable. `IntegrationJob` replaces detached Slack/HubSpot/Drive promises with a separate leased relational queue, provider-specific dedup, current-authority checks, visible status, and explicit retry. Its domain write/enqueue remains separate, and delivery is at least once. The five-minute Worker schedule awaits both drains; direct transactional mail retains its existing request path. See [integration-jobs.md](integration-jobs.md). `/api/health` returns only database availability.

## Deployment and commands

- `npm run dev` starts local Next. `npm run build` builds Next with Turbopack; `npm run lint` runs ESLint.
- `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, and `npm run build` form the checked-in CI gate. E2E uses a fresh loopback PGlite database and scrubbed provider/hosted environment. CI audits production dependencies at high severity. The current production graph has zero findings; one development-only braces advisory remains in the lint chain. See [dependency triage](../docs/dependency-audit.md).
- `npm run db:generate`, `db:push`, `db:migrate`, and `db:deploy` manage Prisma. Apply pending `20261014000000_separate_document_content_and_integration_jobs` before serving the October code; its data backfill must run while legacy upload writers are quiesced, after verifying a restore point.
- `npm run build:cloudflare` builds Next and OpenNext, prunes assets, and copies server WASM. `npm run cf:dry-run` validates the Worker package. `npm run deploy` runs database deployment, Cloudflare build, then Wrangler with `wrangler.production.toml`.
- `scripts/build-opennext.mjs` runs the adapter CLI in a child process. On native Windows, a scoped preload creates confirmed traced directory links as junctions and normalizes readlink separators for Turbopack external-module discovery, avoiding the adapter's EPERM symlink failure. File links and Linux behavior are preserved; no installed dependency or OS permission is modified. OpenNext still recommends Linux/WSL for release builds and emits its Windows warning.
- Next's `outputFileTracingExcludes` excludes `.data`, `.env*`, Git state, Wrangler/OpenNext output, and old development/standalone artifacts. Packaging verification found the local snapshot had been copied into the original trace output; these folders are not hosted runtime dependencies. Production configuration comes from Worker bindings, and local `next dev` still reads its own files normally.
- `custom-worker.ts` wraps the OpenNext Worker for message WebSockets. `wrangler.toml` and `wrangler.production.toml` define the asset binding, Durable Object, and custom domain `boatship.cohortix.in`. Hyperdrive is documented but not enabled in checked-in configuration.
- `wrangler.production.toml` schedules weekday product overdue notifications and an hourly safety run of the webhook/integration drains through `custom-worker.ts`. In production, `lib/queue-drain.ts` starts a drain after the enqueuing response is sent (Next `after`), so the hourly run only retries interrupted or failed work and the idle Worker is not woken every five minutes. `BOATSHIP_CRON_SECRET` is required. The checked-in configuration does not establish a separate staging environment or alert rules.
- `.env.example` lists basic local variables. [Hosted secrets](../docs/cloudflare-secrets.md) and [README](../README.md) explain additional optional configuration. Never commit `.env.local` or secret values.
