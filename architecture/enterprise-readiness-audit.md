# Enterprise readiness audit

Reviewed: 2026-09-24. Scope: repository source and configuration at the current working tree. This is a code and process audit, not a penetration test, production configuration review, legal opinion, or certification assessment. “Not evidenced” means the repository does not establish that a control operates in production.

## Executive assessment

Boatship has a useful client delivery foundation: staff/client roles, onboarding workflows, documents and forms, product planning, notifications, Git evidence, MCP controls, and Cloudflare deployment. It is **not ready to be treated as a broadly deployed enterprise system** until the immediate risks below are resolved and verified. An MNC's exact requirements depend on its data, customers, geography, and internal policies; the list here is a practical minimum for this app's current scope.

The highest priorities are predictable bootstrap credentials, unsafe concurrent writes to the shared client-data snapshot, weak distributed abuse protection, and insufficiently controlled outbound webhook destinations. The app also needs a reproducible release pipeline and a proven recovery path.

## Remediation in the current working tree

The following changes were implemented after the audit baseline and are not yet verified in a live deployment:

| Baseline finding | Current code-level status | Verification still needed |
| --- | --- | --- |
| Fixed seed credentials | Database-backed snapshots no longer seed fixed users. Production login and session resolution reject known seed users while they retain the fixed password. Local development demo seeding remains available. A 2026-09-25 read-only check found zero `seed_admin`/`seed_team` records in both production identity stores. | Use the guarded first-admin provisioning process for a new environment; inventory any other historical accounts before rollout. |
| Concurrent snapshot writes | `StoreSnapshot.version` and conditional updates retry conflicting mutations, including project operations. Migration `20260924010000_version_store_snapshot` was applied to production on 2026-09-25; a synthetic concurrent-write test passed and its temporary row was removed. | Verify full authenticated Worker flows; long-term relationalization is still advisable. |
| Per-process abuse limits | A shared `RateLimitBucket` table now covers login, forgot/reset, invitations, MCP, and agent chat. Migration `20260924020000_add_rate_limit_buckets` was applied to production on 2026-09-25; concurrent synthetic upserts passed and temporary rows were removed. | Verify limits across Worker isolates and add alerting. |
| Webhook egress and secret exposure | New and existing endpoints must match exact operator-approved HTTPS origins before delivery; redirects are blocked. API list/detail/update responses redact signing secrets. | Configure `WEBHOOK_ALLOWED_ORIGINS`, review approved domains, and rotate older secrets as appropriate. |
| Cookie mutation request origin | `proxy.ts` rejects cross-origin cookie-authenticated API writes; focused tests cover same-origin, cross-origin, missing-origin, and bearer-only cases. | Exercise browser flows in staging, including any reverse-proxy origin configuration. |

The checklist below records the initial audit baseline and the remaining enterprise work. Use this remediation table and [status.md](status.md) for the current implementation state.

The confirmed enterprise access boundary is **assigned clients for staff**. The identity provider and recovery objectives remain undecided; their controls need a design choice before implementation.

## Follow-up work in the current working tree (2026-09-25)

- Team client access now uses a server-only helper that reads current assignments and is applied to core client/task/document/form/message routes, aggregate views and exports, reminders, Hodi client context, and MCP project visibility. Policy tests exercise admin, team, and client decisions. A complete staging authorization walkthrough and review of every integration route remain necessary.
- A guarded first-admin command is available at `scripts/provision-first-admin.mjs`; it dry-runs by default, verifies the target host, checks both identity stores, and uses a conditional snapshot write. Legacy account promotion, team creation, and local import scripts are retired because they could bypass versioned writes or introduce demo credentials. See [operations runbooks](../docs/operations/README.md).
- GitHub CI, Dependabot, scoped lint, typecheck, and a test script are checked in. Twelve local tests, lint, typecheck, and the production build pass. The first remote CI run failed at `npm ci` because the lockfile omitted two Linux-required `@emnapi` entries; a follow-up lockfile correction was prepared and awaits remote CI verification. The four high package entries remain open with triage in [dependency-audit.md](../docs/dependency-audit.md).
- Unexpected API errors now return a generic 500 with a request ID in the shared handler and direct-catch routes; the exception stays in server logs.

This work does not establish SSO/MFA, a staging environment, backup restore success, alert delivery, durable outbox processing, private object storage, retention policies, or WCAG conformance. Those controls need separate implementation and operational evidence before enterprise rollout. The existing `https://httpbin.org` webhook origin is not approved in `WEBHOOK_ALLOWED_ORIGINS`, so outbound delivery to it remains blocked.

## Immediate release blockers at the audit baseline (P0)

| Finding | Evidence | Required outcome |
| --- | --- | --- |
| **Predictable privileged accounts on an empty store.** `ensureSeed` inserts `admin@boatship.local` with `admin123` and a team account with `team123` whenever there are no users. It is called by the database-backed read path, not restricted to local demo mode. | [`lib/store.ts`](../lib/store.ts) lines 325–409, 1718–1726; [`README.md`](../README.md) claims hosted demo credentials are disabled. | Never seed fixed credentials in hosted mode. Bootstrap the first admin through a one-time, environment-scoped provisioning flow; rotate or remove any accounts already created by this path and verify deployed data. |
| **Client delivery writes can be lost.** A Worker isolate caches the entire `StoreSnapshot`, mutates it in memory, and writes the whole JSON record without a version condition. Two requests or isolates can read the same version and the later save can erase the earlier change. `mutateProjectOps` also writes the whole snapshot. | [`lib/store.ts`](../lib/store.ts) lines 636–640, 1689–1705, 1708–1743. | Move frequently edited entities to relational tables, or add transactional compare-and-swap/versioned writes with retries. Prove concurrent task/message/document updates survive. |
| **Authentication and API abuse limits are per process.** Login attempts and MCP request counts use in-memory `Map`s; forgot/reset password routes have no comparable shared throttle. A distributed Worker deployment can serve requests in multiple isolates. | [`app/api/auth/login/route.ts`](../app/api/auth/login/route.ts) lines 9–29; [`lib/mcp-controls.ts`](../lib/mcp-controls.ts) lines 10–24; [`app/api/auth/forgot-password/route.ts`](../app/api/auth/forgot-password/route.ts). | Use a shared edge or database-backed rate limit keyed by IP and account/identity, with monitoring. Cover login, reset, invitations, MCP and expensive agent endpoints. |
| **Configured webhooks can reach arbitrary HTTP(S) URLs.** The admin API accepts any such URL and the dispatcher fetches it without public-destination controls or redirect restrictions. A compromised admin account could use this as a server-side request forgery path. The API also returns stored webhook records, including their raw secrets. | [`app/api/webhooks/route.ts`](../app/api/webhooks/route.ts) lines 31–84; [`lib/webhooks.ts`](../lib/webhooks.ts) lines 5–48; [`types/index.ts`](../types/index.ts) `WebhookEndpoint`. | Restrict destinations to approved HTTPS hosts or validate public IPs after DNS resolution, reject local/private addresses, control redirects, and return only redacted secrets after creation. Rotate exposed secrets where needed. |

## Enterprise minimum checklist

Priority: **P0** before wider production use; **P1** before MNC rollout; **P2** before organization-wide scale. “Present” reflects code only. A configured service or an external policy still needs live verification.

| # | Capability an MNC needs | Current evidence and status | Priority / next step |
| --- | --- | --- | --- |
| 1 | Secure user bootstrap and lifecycle | Fixed seed accounts are a P0 issue. Invites, password reset, and account/session routes exist; new account work is uncommitted. | **P0** remove fixed bootstrap; **P1** document joiner/mover/leaver process and immediate deprovisioning. |
| 2 | Central identity, MFA, and SSO | Local passwords and sessions exist. No SAML/OIDC SSO, enforced MFA, or SCIM provisioning was found. | **P1** integrate the company's identity provider; enforce MFA and central offboarding. |
| 3 | Least privilege and organizational data boundaries | Admin/team/client roles, staff permissions, client ownership, and product membership checks exist. Staff access to client records is broad; no organization/business-unit tenancy model is present. | **P1** define who may see each client/project, then enforce server-side scopes and test cross-client/cross-team access. |
| 4 | Session and browser request protection | Database-backed hashed sessions, HTTP-only cookie and session revocation exist. `SameSite=Lax` is present; no shared CSRF/Origin/Fetch Metadata guard for mutating cookie-authenticated routes was found. | **P1** add a consistent request-origin/CSRF control and audit all state-changing routes. |
| 5 | Strong input, outbound request, and error controls | Many endpoints validate fields; Git webhooks verify signatures. Configurable outbound webhook URLs accept any HTTP(S) destination. [`lib/api.ts`](../lib/api.ts) sends raw exception messages back to clients on 500 responses. | **P0** close SSRF path; **P1** use schemas, limits, and authorization checks consistently, and send generic server errors with internal correlation IDs. |
| 6 | Accurate, concurrent, recoverable data | Neon/Prisma is present; client-domain writes still replace one large JSON snapshot. No tested backup/restore or recovery runbook is in the repo. | **P0** prevent lost updates; **P1** define RPO/RTO, automate backups, rehearse a restore, and document rollback. |
| 7 | Document storage and retention | Uploads are validated for type and 10 MB size, but base64 file content is stored in the database snapshot and versions accumulate. No object-storage, malware scan, classification, or retention schedule is evident. | **P1** choose durable private object storage, scan uploads, set file limits/retention, and test download authorization. |
| 8 | Tamper-resistant audit trail | Client activity export and relational MCP audit exist, but much activity lives in the mutable snapshot; client deletion removes its activity and only returns a deletion summary. | **P1** record security/admin/data events in an append-only or restricted audit store with retention, search, actor, timestamp, and export. |
| 9 | Privacy and data governance | GDPR-named export and delete routes exist. Export omits document binary; policies for retention, legal hold, data residency, consent, and access review are not evidenced. | **P1** inventory personal data and processors, define retention/deletion exceptions, and verify export/delete completeness against policy. |
| 10 | Reliable events and integrations | Composio, Resend, webhooks, and Drive hooks exist. Some client-create side effects use untracked `void` promises; webhook deliveries are logged but no durable retry queue/dead-letter flow is shown. | **P1** use a durable outbox/queue with idempotency, retry, dead-letter handling, delivery visibility, and explicit approval for external actions. |
| 11 | Automated quality and release gates | `build` and `lint` scripts exist. No repository CI configuration, automated test suite, or test command was found. Typecheck passed, but focused source lint found 20 errors and 10 warnings; the root lint command also traverses a generated backup tree. | **P1** scope lint to maintained code, clear the baseline, add focused auth/authorization, store-concurrency, workflow, migration and smoke tests; gate merges on test, typecheck, lint, build and security checks. |
| 12 | Dependency and supply-chain management | Lockfile exists. The 2026-09-24 `npm audit --omit=dev` run reported four high-severity package entries in the Prisma dependency chain; reachability and fixes need triage. No automated dependency/SBOM policy found. | **P1** triage advisories, update safely, automate dependency scanning and review new dependencies. |
| 13 | Monitoring, alerting, incident response | Cloudflare observability is enabled at 10% head sampling. Errors often go to `console.error`; no alert rules, SLOs, health check, on-call path or incident runbook are evidenced. | **P1** add request correlation, error/latency dashboards, alerts, SLOs and an incident response playbook. |
| 14 | Secure deployment and environment separation | OpenNext/Wrangler build and migration scripts exist; a production config and secret guidance exist. No staging environment, approval gate, migration rollback, or release/rollback runbook is evidenced. | **P1** establish dev/staging/prod separation, smoke tests, protected deployment approval and rollback procedure. |
| 15 | Business continuity and disaster recovery | No recovery objectives, restore exercise, failover plan, or documented handling for Neon/Resend/Composio outages is evidenced. Polling is a useful fallback for realtime messaging. | **P1** set RPO/RTO and test backup restoration and degraded-mode behavior. |
| 16 | Accessible, usable workflows | The UI has some labels and semantic elements. No WCAG 2.2 AA audit or automated/manual accessibility gate is evident. | **P1** audit keyboard, focus, contrast, errors, responsive layout, and screen-reader paths; fix critical client/staff flows. |
| 17 | Scale and performance | Optional Redis caching exists, but snapshot reads/writes and full-document storage create growth pressure. No capacity targets or load test is present. | **P2** set workload targets; load-test concurrent clients and background jobs; migrate hot data out of the snapshot. |
| 18 | Enterprise workflow controls | Tasks, approvals, evidence, products, reminders, and analytics already exist. No SLA/escalation policy, configurable business-unit workflow, or formal change approval across all high-impact actions is evidenced. | **P2** add only the workflow rules required by actual departments; keep approvals auditable. |
| 19 | AI and integration governance | Hodi has scoped staff access, proposal approvals and review-only automations. Connected app permissions and data sent to model providers need organization policy; no DLP/evaluation regime is evidenced. | **P2** inventory AI data flows, restrict tools and scopes, log approvals, and test prompt-injection/data-exfiltration scenarios. |
| 20 | Documentation and ownership | Architecture and product records exist. No explicit service owner, support escalation matrix, operational runbooks, or change-review cadence is recorded. | **P2** assign owners and maintain runbooks, data-flow diagrams, and periodic access/risk reviews. |

## Suggested implementation order

1. **Security and data integrity sprint:** eliminate fixed accounts; fix concurrent writes; protect webhook egress and secret exposure; add shared abuse limits; add a cross-route CSRF/origin strategy.
2. **Release foundation:** add CI and a small set of meaningful tests, dependency triage, staging, migration and rollback checks, plus production alerts.
3. **Enterprise access and recovery:** connect corporate SSO/MFA, scope staff access by client or business unit, define audit retention, and complete a real restore drill.
4. **Data and workflow scale:** move files out of the snapshot, establish retention and deletion policy, make external delivery durable, then add only requested SLA/workflow/AI governance features.

## Tools to repeat this audit

| Need | Tool or checklist | Use here |
| --- | --- | --- |
| Security requirements | [OWASP ASVS](https://owasp.org/projects/asvs) | Turn authentication, access, validation, logging and configuration requirements into reviewable checks. |
| Secure development process | [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) | Define code review, dependency, build and release evidence. |
| Dependency and code scanning | `npm audit`, plus [GitHub code scanning and Dependabot](https://docs.github.com/en/code-security) if GitHub is the chosen CI host | Triage actual findings and run checks on every change. Scanner findings still need manual reachability review. |
| Web security testing | [OWASP ZAP](https://www.zaproxy.org/docs/) against staging | Exercise authenticated routes and common web risks after the P0 fixes. Avoid active scanning production without an agreed window. |
| Accessibility | [axe-core](https://github.com/dequelabs/axe-core) plus manual WCAG 2.2 checks | Automate common violations and manually verify keyboard and screen-reader tasks. |
| Capacity | [Grafana k6](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/) | Reproduce concurrent snapshot writes and measure API behavior at the target user load. |

## Verification performed and limits

- Read architecture, source, schema, deployment configuration, and existing feature docs. Checked for CI/tests/SSO/MFA/CSRF and related controls in the repository.
- Ran `npm audit --omit=dev` on 2026-09-24: four **high** package entries (`@prisma/config`, `deepmerge-ts`, `effect`, `prisma`), zero critical. This reports dependency advisories, not proof that Boatship exposes the vulnerable code path; triage before changing versions.
- `npx tsc --noEmit` passed. `npx eslint app components lib proxy.ts custom-worker.ts` finished with 20 errors and 10 warnings, mostly React hook and purity rules. The root `npm run lint` was stopped after it began scanning `.next-predeploy-backup` generated files; its result is therefore unknown. No live production, database, Cloudflare dashboard, backup, or identity-provider configuration was inspected.

## Baseline references

- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) for secure development and release practices.
- [OWASP ASVS](https://owasp.org/projects/asvs) for testable web application security requirements.
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) and [SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) for the request risks cited above.
- [NIST CSF Recover](https://www.nist.gov/cyberframework/recover) for recovery planning and [NIST incident response guidance](https://csrc.nist.gov/pubs/sp/800/61/r3/final).
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) for accessibility targets.
- [Cloudflare Worker execution context](https://developers.cloudflare.com/workers/runtime-apis/context/) for background-work lifetime.
