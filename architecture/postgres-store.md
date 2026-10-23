# PostgreSQL store (ClickHouse Cloud)

Last reviewed: 2026-10-23. Implemented in the working tree; hosted deployment with `DATABASE_URL` as a Worker secret is pending.

## Decision

On 2026-10-23 the user chose to move all application persistence to a PostgreSQL service hosted by ClickHouse Cloud (PostgreSQL 18, `ap-south-1`). The Firestore port of 2026-10-22 ([firestore-port.md](firestore-port.md)) had put every data access behind one small storage interface (`FirestoreClient` in `lib/firestore/types.ts`), so the switch adds a third implementation of that interface instead of rewriting the modules again. The Firestore database was still empty, so nothing is migrated. Document bytes stay in Firebase Storage ([document-storage.md](document-storage.md)).

## Runtime

- `lib/firestore/postgres.ts` is `PostgresFirestore`, built on the `postgres` (postgres.js) driver, which runs in Node and in the Cloudflare Worker under `nodejs_compat`. TLS is always required (`ssl: "require"`); the service accepts plain connections too, but the client never uses them.
- One table holds every collection: `documents (collection text, id text, doc jsonb, update_time text, primary key (collection, id))` plus a GIN `jsonb_path_ops` index on `doc`. The table and index are created on first use with `CREATE ... IF NOT EXISTS`; there are no schema migrations. `DATABASE_TABLE` overrides the table name, which the tests and the QA harness use for scratch tables.
- Documents are stored as JSON. `Date` values become `{"$date": iso}` and `Uint8Array` values become `{"$bytes": base64}`; `undefined` fields are dropped. Application code keeps timestamps as ISO strings, so these tags appear only in the `DocumentContent` byte records.
- `update_time` is a microsecond ISO-8601 string produced by `clock_timestamp()` on every write and is the optimistic-concurrency token behind `updateTime` preconditions.
- Query operators map to jsonb expressions: equality on a top-level scalar uses containment (`doc @> {...}`) so the GIN index applies; other equalities, `in`, `not-in`, `array-contains` and `array-contains-any` compare jsonb values; range operators compare only values of the same type (strings by code point under `COLLATE "C"`, numbers as `numeric`, dates by their ISO text), matching Firestore. `orderBy` excludes documents that lack the field and sorts with Firestore's cross-type rank, then the natural order within the type, then `id`. `limit` is pushed down; `count` is `count(*)` over the same predicate. IN lists are not chunked because PostgreSQL has no 30-item cap.
- `commit` runs in one transaction: it locks each target row with `SELECT ... FOR UPDATE`, checks every precondition (`exists`, `updateTime`, and the implicit "must exist" of an update), then applies all writes. A set is an upsert, an update is `doc || patch` (top-level field replacement), a delete without precondition is a no-op when the row is missing. Any failure rolls the whole commit back.
- `runTransaction` opens a `SERIALIZABLE` transaction, runs the body's reads on that connection, applies the queued writes through the same precondition path, and retries on serialization failure (`40001`) or deadlock (`40P01`) with backoff, up to `attempts` (default 5). Driver errors become `FirestoreError` with statuses `ALREADY_EXISTS` (`23505`), `ABORTED`, `UNAVAILABLE` (connection failures), or `INTERNAL`; errors thrown by a transaction body pass through unchanged.
- Selection in `lib/firestore/index.ts`: `FIRESTORE_EMULATOR_HOST` (tests) wins, then `DATABASE_URL` selects PostgreSQL, then `FIREBASE_SERVICE_ACCOUNT` keeps the Firestore REST client as a fallback. `isHostedStore()` is true for any of them. Operator scripts (`scripts/lib/firestore-cli.mjs`) follow the same order, so `scripts/provision-first-admin.mjs` and `scripts/remove-users.mjs` work against PostgreSQL unchanged.
- Pool: four connections per process (two in scripts), 15 s connect timeout, 60 s idle timeout, 30 min connection lifetime. The Worker runs the app inside the `AppRuntime` Durable Object, so a pool lives as long as that instance.

## Configuration

`DATABASE_URL` is the full `postgresql://` connection string from the ClickHouse Cloud console. Locally it goes in `.env.local`; in production it must be a Wrangler secret (`scripts/worker-secrets.mjs` includes it; `scripts/scrub-env-bundle.mjs` strips it from the OpenNext bundle). `cloudflare-env.d.ts` declares it. The Firestore variables stay documented in `.env.example` because the fallback client is still in the repository.

## Verification

- `npm run test:postgres` runs the shared storage contract (`tests/firestore.test.mjs`) against the in-memory client and, when `DATABASE_URL` is set, against the live service in a scratch table named `contract_test_<pid>` that is dropped afterwards. It passed on 2026-10-23 (three tests, about 8 s for the PostgreSQL leg because of the round trip to `ap-south-1`), including six concurrent serializable counter transactions.
- `npm run test:e2e:postgres` runs the isolated end-to-end suite with `next dev` on a scratch table when `QA_DATABASE_URL` is set (the harness never touches the production `documents` table and drops its table on close). It passed on 2026-10-23: 13 tests, about 142 s. `npm run test:e2e` still runs the same suite on the Firestore emulator.
- `npm test` (101), `npm run typecheck`, and `npm run lint` pass. The Cloudflare build and Wrangler dry run are recorded in [status.md](status.md).

## Limits and open work

- Every collection shares one table and the only index is the GIN index on `doc`; filters on nested paths, ranges, and ordering are sequential scans within a collection. Add expression indexes on `(collection, (doc->>'field'))` when a collection grows past tens of thousands of rows.
- jsonb drops duplicate keys and does not preserve key order; application documents never depend on either.
- ClickHouse Cloud's PostgreSQL service is new; its backup and restore procedure, connection limits, and SLA have not been checked. The database is reachable from the public internet with password authentication, so the password must stay a secret.
- The 1 MiB document and 500-write transaction limits of Firestore no longer apply, but the snapshot slice cap of 900 KB in `lib/store.ts` is kept so the Firestore fallback still works.
