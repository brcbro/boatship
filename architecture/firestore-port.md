# Firestore persistence port

Last reviewed: 2026-10-22. In progress in the working tree; Neon/Prisma remain in the repository until every module below is ported.

## Decision

The user chose to leave Neon PostgreSQL (its free-tier compute quota was exhausted and blocked every deploy) and rewrite the data layer onto Firestore in the existing `boatship-main` Firebase project, accepting one to two weeks of work. Files already moved to Firebase Storage ([document-storage.md](document-storage.md)). The new database starts empty; Neon data is not migrated.

## Runtime

- `lib/firestore/` holds the only Firestore access path. `client.ts` is a fetch-only REST client (no Admin SDK, no gRPC) so it runs inside the Cloudflare Worker: `batchGet`, `runQuery`, `runAggregationQuery` for counts, `commit` with per-document preconditions, and `beginTransaction`/`commit`/`rollback` with retry on `ABORTED`. `memory.ts` implements the same `FirestoreClient` interface in memory for unit tests, including precondition and transaction-abort semantics. `tests/firestore.test.mjs` runs one contract against both, and `npm run test:firestore` runs it against the Firestore emulator.
- `index.ts` selects the client: `FIRESTORE_EMULATOR_HOST` (plus `FIREBASE_PROJECT_ID`, default `demo-boatship`) for tests, otherwise the service account from `FIREBASE_SERVICE_ACCOUNT` (JSON, or a bare PEM key with `FIREBASE_CLIENT_EMAIL`; project id from `FIREBASE_PROJECT_ID` or the service-account email). `FIRESTORE_DATABASE` selects a named database (default `(default)`). `isHostedStore()` replaces every former `DATABASE_URL` check; `isLocalDemoStore()` replaces `ALLOW_LOCAL_STORE && !DATABASE_URL`.
- `lib/google-auth.ts` signs RS256 service-account assertions with WebCrypto and caches one access token per scope set; Storage and Firestore share it.

## Conventions for every ported module

1. One Firestore collection per former Prisma model, named exactly like the model (`UserProfile`, `IntegrationJob`, `Product`, ...). Use `new Collection<Doc>("Model")` from `@/lib/firestore` and export it with a `Doc` type whose fields match the old columns.
2. Document id = the model's primary key. For composite unique keys use a deterministic id (`${a}__${b}`, e.g. `UserProviderSecret` is `${userId}__${provider}`, `ProductMember` is `${productId}__${userId}`, `GitTaskLink` is `${taskId}__${repositoryId}`, `McpProjectAccess` is `${identityId}__${projectId}`, `TaskManagerApproval` is the `taskId`). Keep an `id` field inside the document equal to the document id so queries can still filter on it.
3. Timestamps are ISO-8601 strings (`nowIso()`), never `Date` objects, so range filters and ordering match the old `timestamptz` columns. Convert at the API boundary only if a response previously exposed `Date`.
4. `null` for absent optional values, matching the old nullable columns; `undefined` fields are dropped by the codec. Firestore skips documents that lack a filtered or ordered field, so always write every field.
5. Avoid composite indexes: filter on equalities and sort in memory when the result set is bounded (per-user, per-client lists). Only `firestore.indexes.json` entries listed there are deployed; a query that needs a new composite index must add it there and be exercised against the real project.
6. Multi-document atomicity uses `getFirestore().runTransaction(...)` (reads through `tx`, writes queued with `tx.write`). Compare-and-set updates (`UPDATE ... WHERE status = 'x'`) become a transaction that reads, checks, and writes. Lease claims (`FOR UPDATE SKIP LOCKED`) become a transaction per batch that re-reads candidates and claims only still-eligible ones. Unique-key inserts use `precondition: { exists: false }` and treat `ALREADY_EXISTS` as the former P2002.
7. Relation filters and includes (`product: { members: { some } }`, `include: { repository }`) become separate queries joined in memory. `IN` lists are chunked automatically by the client.
8. Bulk deletes use `deleteWhere` from `@/lib/firestore/bulk`; cross-collection cascades are not atomic and must be ordered so a crash leaves orphans, not dangling references.
9. Never import `@/lib/prisma` or `@/generated/prisma` in ported code. The local demo (`ALLOW_LOCAL_STORE=1`) keeps its file-based paths where they existed.

## Status

Ported: delivery store snapshot (one document per slice under `StoreSnapshot/main:<slice>` plus `StoreSnapshot/main` meta, written in a transaction), `UserProfile`, `NotificationRecord`, `AuthSession`, `Engagement`, `ClientContact`, `RateLimitBucket`, `DocumentContent`, `UserProviderSecret`, and the routes that use them.

Pending: `IntegrationJob`, `HodiQueueItem`, `HodiActionProposal`, `HodiCommunicationProposal`, `HodiAutomationRuleState`/`Run`, `ComposioConnection`, products (`Product*`), git (`GitRepositoryConnection`, `GitTaskLink`, `GitEvidence`, `GitValidationRun`, `DefinitionOfDonePolicy`, `TaskManagerApproval`), MCP (`McpIdentity`, `McpProjectAccess`, `McpAuditEvent`), Prisma removal, the e2e harness, scripts, and deploy configuration.

## Limits to respect

A Firestore document holds at most 1 MiB, so each snapshot slice is capped at 900 KB of JSON and the store throws a clear error beyond that; activity and message retention is the next step if a slice approaches the cap. Transactions take at most 500 writes. Inline `DocumentContent` bytes are only accepted up to 900 KB; larger files require Firebase Storage.
