# Account foundations

Last reviewed: 2026-10-23. Implemented in the repository (plan phases 0 and 1 of [accounts-plan.md](accounts-plan.md)); not yet deployed to the Worker and not yet exercised against the hosted database.

This record describes the identity and credential layer (phase 0) that the later account, team and client-administration work builds on, and the personal account sections built on it (phase 1, below).

## What changed

| Area | Before | Now |
| --- | --- | --- |
| Account state | Derived from `mustResetPassword`; no way to suspend. | Explicit `status` (`invited`, `active`, `suspended`, `deactivated`) and `authzVersion` on `UserProfile`. `lib/account-status.ts` derives the status of records written before the field existed and holds the one rule every sign-in path applies (`accountCanAuthenticate`). |
| Profile writes | Routes re-wrote the whole user (`upsertUser({...user, name})`), so a concurrent password or permission change could be overwritten. | `DataStore.updateUserFields(uid, patch)` replaces only the submitted fields. `/api/account` PATCH, the digest stamp and the staff permission editor use it; the hosted store issues a partial document update, the local demo patches in place. |
| Invitation and reset links | One `inviteToken` field per user served both purposes; a re-invitation of an active client cleared their password. | `CredentialAction` records: hashed token, purpose (`invite` or `password_reset`), expiry, consumed/revoked timestamps, issuer and correlation id. A link is purpose-bound and single-use. Re-inviting an active account issues a new link and leaves password, status and permissions alone. |
| Email uniqueness | Lookups by `email` on a JSON table with no unique index; two concurrent invitations could create two identities. | `IdentityEmailClaim`, keyed by the SHA-256 of the normalised address, created with an exists:false precondition in the same transaction as the profile. |
| Audit | Client activity only (deleted with the client). | `AccountAuditEvent`: append-only, sanitised actor/target/action/result/reason/correlation id, written in the transaction that makes the change where there is one. Keys containing token, password, secret or hash are dropped from metadata. |
| Account mail | Sent before the user was written; a failed send left no record and the route reported an error with no user. | `AccountMailIntent` committed with the change (`queued`), delivered afterwards, outcome written back (`sent` with the provider id, or `failed` with the message). Routes report a failed send as a 502 after the record exists; inviting the same address again reuses the account and issues a fresh link. |
| Sessions | Public id was the token hash; a session issued before a credential change stayed valid; removal on another runtime instance waited for the 30 s memo on every path. | Records carry an opaque `publicId` and the user's `authzVersion` at issue. Verification re-checks status and version and deletes a record that fails. Mutating requests (anything but GET/HEAD) skip the per-runtime memo and verify against the database; reads may use the memo for up to 30 s. A password change bumps the version, revokes every session and issues a new one to the caller. |

## Records

All records live in the shared JSON document table ([postgres-store.md](postgres-store.md)) through `Collection` helpers in `lib/accounts.ts`. Timestamps are ISO-8601 strings.

| Collection | Key | Fields |
| --- | --- | --- |
| `UserProfile` (additions) | `uid` | `status`, `authzVersion`, `updatedAt`, `statusChangedAt`, `statusReason`. Absent on older records; the codec in `lib/store.ts` derives `status` and treats a missing version as 0. |
| `CredentialAction` | random id | `purpose`, `userId`, `tokenHash`, `expiresAt`, `consumedAt`, `revokedAt`, `createdAt`, `createdBy`, `correlationId`. Looked up by `tokenHash`. |
| `IdentityEmailClaim` | sha256(email) | `email`, `userId`, `createdAt`, `updatedAt`. |
| `AccountAuditEvent` | random id | `action`, `actorId`, `actorRole` (`admin`/`team`/`client`/`system`), `targetUserId`, `result`, `reason`, `correlationId`, `metadata`, `createdAt`. |
| `AccountMailIntent` | random id | `kind`, `userId`, `to`, `status`, `attempts`, `providerMessageId`, `lastError`, `correlationId`, `createdAt`, `updatedAt`, `sentAt`. |
| `AuthSession` (additions) | token hash | `publicId` (`ses_…`), `authzVersion`. Older records get a derived `legacy_…` public id that cannot be turned back into the hash. |

The profile remains the authoritative identity record; the legacy `StoreSnapshot` user slice is refreshed best-effort after each transaction (`DataStore.syncUserProfile`). The local demo (`ALLOW_LOCAL_STORE=1` without a database) keeps the auxiliary collections in memory for the life of the process and applies the user update as a separate write; that mode is not transactional and is for development only.

## Transactions

- **Invite** (`inviteAccount`): read the claim (or the unclaimed legacy profile), refuse suspended/deactivated owners, create or reuse the profile, write the claim if missing, revoke earlier pending invitation links, store the new hashed link, the queued mail intent and the audit event. The body re-runs when a concurrent invitation wins the claim. Email is sent after the commit.
- **Redeem** (`redeemCredentialAction`): find the action by hash, check purpose/expiry/consumed/revoked and the account status, then in one commit mark the action consumed (update-time precondition), set the password, clear the legacy token fields, set `status: active` and bump `authzVersion`. Two concurrent redemptions have one winner. Sessions are revoked afterwards by the reset route.
- **Account change** (`applyAccountChange`): compute the patch from the record inside the transaction, optionally bump the version, write the audit event. Used by password change and staff permission edits (no version bump) and by `setAccountStatus` (version bump).
- **Password reset issue** (`issuePasswordReset`): revoke earlier reset links, store the new one and its mail intent. Returns nothing for suspended/deactivated accounts and records the denial.

## Sign-in rule and propagation

`accountCanAuthenticate(user)` is `status === "active" && !mustResetPassword`. It is applied by cookie/bearer verification (`lib/auth.ts`), MCP identity resolution (`lib/mcp-auth.ts`), queued integration jobs (`lib/integration-jobs.ts`) and login. Login checks the password before the status so the response does not reveal whether a suspended account exists; the owner then receives a plain message.

Propagation of a status or version change committed elsewhere: mutating API requests are denied at once; reads on another runtime instance may be served for up to `SESSION_CACHE_TTL_MS` (30 s). Live `MessageRoom` sockets are not closed by this change: a ticket is verified only at upgrade, so an open socket outlives a suspension until the client reconnects. That bound stands until the socket path is reworked; account UI copy must not promise immediate socket termination.

## Endpoints

| Endpoint | Behavior now |
| --- | --- |
| `GET/PATCH /api/account` | Own DTO includes `status`; PATCH writes only `name`/`digestEnabled` through the field-level update. Responses are `private, no-store`. |
| `POST /api/account/password` | Shared policy (8–128), 10 changes per hour per user, versioned credential write with audit, all sessions revoked, fresh session returned (`token`, `signedOut`) and set as the cookie. |
| `GET/DELETE /api/account/sessions` | Session ids are opaque public ids. Revoke-others is unchanged. |
| `POST /api/auth/login` | Rejects non-active accounts after password verification; sessions are issued under the current authz version. |
| `POST /api/auth/forgot-password` | Issues a hashed reset action and mail intent, then sends. Same response whether or not the account exists. |
| `POST /api/auth/reset-password` | Redeems invitation or reset actions; falls back to the legacy `inviteToken` field for links issued before this change until they expire (at most 14 days). Never reactivates a suspended or deactivated account. |
| `POST /api/users/invite`, `POST /api/clients/[id]/invite`, `POST /api/notify` (`invite`) | Use `inviteAccount`. Address conflicts are refused as before; a failed send returns 502 after the record is committed. The client invitation response includes `existingCredentialsKept`. |
| `PATCH /api/users` | Permission edits are field-level and audited (`staff.permissions.changed`); they do not sign the person out, because every verification rebuilds the session from the profile. |

No suspend/reactivate endpoint exists yet; `setAccountStatus` is the domain operation the phase 2 lifecycle API will call.

## Migration

`scripts/backfill-account-foundations.mjs --expect-target <database host>` plans, and with `--apply` writes, the explicit status, a zero authz version and one claim per address for records written before this change. It stops with a list of problems instead of guessing when it finds duplicate addresses, a claim that belongs to another user, an unknown status value or a profile without an address; `scripts/lib/account-backfill.mjs` holds the pure planner and is unit-tested. Legacy invitation links are counted and left to expire. `scripts/provision-first-admin.mjs` and the QA fixture write the new fields and the claim directly.

Old records keep working without the backfill: the codec derives status, missing versions read as 0, and the invitation service writes a missing claim on the next invitation of that address.

## Verification

`tests/accounts.test.mjs` (9 tests, in-memory client): a name save after a concurrent password change keeps the new hash; two concurrent staff invitations create one identity and one claim; one of two concurrent redemptions of a link wins and the link is dead afterwards; re-inviting an active client keeps their password and leaves one live link; a failed provider send is recorded and a retry reuses the account; a suspension committed on another runtime denies a PATCH at once and a GET after the memo; a reset never reactivates a suspended account and an older reset link dies when a new one is issued; session public ids are opaque and rotation leaves one valid session; the backfill planner refuses duplicates and dangling claims.

Unit suite (112), typecheck and lint pass. Not run: the end-to-end suite on a scratch table (`QA_DATABASE_URL` is not set on this machine), the Firestore emulator suite, the Cloudflare build, and any hosted check; the hosted invitation and reset flows should be exercised with synthetic users before this is relied on.

## Phase 1: personal account sections

Implemented 2026-10-23 on top of the records above. `components/shared/AccountSettings.tsx` is gone; `components/shared/account/` holds one `AccountLayout` and six section components rendered by thin pages under both shells. Each section loads and saves on its own through `useAccountResource` (one endpoint per call, no shared `Promise.all`), so a failing session list never hides name editing.

| Section | Staff URL | Client URL | Data |
| --- | --- | --- | --- |
| Profile | `/account` | `/portal/account` | `GET/PATCH /api/account` (name only; email read-only with copy that says the change flow does not exist yet). |
| Security and sessions | `/account/security` | `/portal/account/security` | Password change (unchanged route), `GET /api/account/sessions`, `DELETE /api/account/sessions` (others), `DELETE /api/account/sessions/[id]` (one), `GET /api/account/security-events`. |
| Notifications | `/account/notifications` | `/portal/account/notifications` | Staff: the digest flag through `PATCH /api/account`, with copy that says digests run only when an administrator sends them. Clients: no digest control; always-sent security mail is explained. |
| Preferences | `/account/preferences` | `/portal/account/preferences` | `ThemePicker` (browser-only, said so) plus `GET/PATCH /api/account/preferences`. |
| My access | `/account/access` | `/portal/account/access` | `GET /api/account/access`. |
| Privacy and requests | `/account/privacy` | `/portal/account/privacy` | `GET/POST /api/account/requests`. |

Layout: identity summary (initials, name, email, role) from the verified session, a vertical six-item navigation from `lg`, horizontal scrolling tabs below it, one main column. The staff Settings entry is now "My account"; the client More menu and header link use the same label; the command palette lists every section. `proxy.ts` needed no new entries because `/account` and `/portal` match their subpaths; `tests/account-routes.test.mjs` asserts the redirects for every section URL.

### Endpoints added

| Endpoint | Behavior |
| --- | --- |
| `DELETE /api/account/sessions/[id]` | Revokes one own session by public id. `revokeDatabaseSessionByPublicId` compares derived ids across the user's own records, so a legacy id works and another user's id is a 404. Revoking the current session returns `signedOut: true` and clears the cookie; the client then signs out. Audited as `session.revoked` / `session.revoked.current`; revoke-others now writes `sessions.revoked.others`. |
| `GET /api/account/access` | Role, status, every capability group with `granted` flags (`lib/account-access.ts`, grouped Client work / Reviews / Reporting / Configuration with admin-only markers), the effective key list, assigned clients for team users (from `listClients({ assignedTeamMemberId })`, never the general list), product memberships for staff, and the own organization with the assigned contact's name for clients. |
| `GET /api/account/security-events` | Own audit events, newest first, `limit` (default 20, max 50) and `before=<createdAt>` cursor; `nextBefore` says whether an older page exists. Only a fixed allowlist of actions is returned, with label, result, `by` (you / administrator / staff / system) and time; reasons, metadata and actor ids never leave the server. |
| `GET/PATCH /api/account/preferences` | `timezone` (IANA, validated with `Intl.DateTimeFormat`) and `hourCycle` (`12h`/`24h`), null to clear; any other field is a 400. Stored on the profile (`UserProfile.timezone`, `hourCycle`; absent on older records) through `updateUserFields`. Used by `formatAccountDateTime` on the account pages only; other screens still follow the device. |
| `GET/POST /api/account/requests` | `AccountRequest` records (`id`, `kind` access/export/deactivation, `userId` from the session, `status`, bounded `reason`, decision fields, timestamps) in the shared document table. One open request per kind, 10 creations per hour per user, audited as `account.request.<kind>.created`. The DTO omits the reviewer. No review or fulfilment exists yet, so every request stays `open`; the UI says so and invents no support address or deadline. |

`staffRequestPermissionRules` now lists `/api/account/*` explicitly as requiring no capability, so a team user with `permissions: []` can use every section.

Not shipped, by plan: verified email change, MFA, recent-authentication proofs, device descriptions (sessions are listed by time only, with copy that says why), per-category notification controls, client digests, and request review.

### Verification

`tests/account-routes.test.mjs` (6 tests) drives the route handlers with cookie-authenticated `Request`s over the in-memory client: per-session revoke including cross-user 404s and current-session sign-out; preference allowlist, validation, session-bound writes and survival of a concurrent credential change; the access summary for an admin, a team user with `[]`, a team user with two capabilities and a client, with no other organization or unassigned client in the response; security-event sanitisation and cursor paging without duplicates or another user's events; account requests bound to the session with duplicate-open and validation refusals; and `proxy` redirects for all twelve section URLs plus the capability policy for a zero-capability team user.

## Open work from the plan

Phase 2 onwards: recent-authentication proofs, verified email change, the staff lifecycle API over `setAccountStatus` with last-admin safeguards and handover, invitation listing/resend/revoke, account-request review, client portal rosters, safe device summaries on sessions, and socket revocation.
