# Backup, restore, and recovery exercise

Last reviewed: 2026-10-26. This runbook describes the procedure; it is not evidence that any backup exists or that a restore has been tested. Nothing in it has been rehearsed against the hosted service yet.

**Decision pending:** the business owner has not set an RPO (maximum acceptable data loss) or RTO (maximum acceptable outage). Choose both with the owner before settling backup frequency, retention, and alert thresholds. The service region is `ap-south-1`; record any data-residency restriction that limits where backup copies may be kept.

## What holds the data

All application persistence is one PostgreSQL service on ClickHouse Cloud (PostgreSQL 18), reached by the Worker through the Cloudflare Hyperdrive config `boatship-db` (query caching disabled) and by operators directly with `DATABASE_URL` ([architecture/postgres-store.md](../../architecture/postgres-store.md)). Two tables hold everything:

| Table | Contents |
| --- | --- |
| `documents` | Every collection as `(collection, id, doc jsonb, update_time)`: the `StoreSnapshot` slices and meta document (clients, tasks, documents metadata, activity, messages, and the rest), `UserProfile`, `AuthSession`, `NotificationRecord`, `Engagement`, `ClientContact`, `DocumentContent` ownership records, `IntegrationJob`, `ActivityArchive`, product, Hodi, MCP and rate-limit collections. |
| `documents_blobs` | Uploaded file bytes (`key, bytes bytea, content_type, size, created_at`), keyed `documents/<clientId>/<documentId>/<contentId>`. |

The tables and their indexes are created by the application (`CREATE ... IF NOT EXISTS` on first use), so a restore only needs the data; the application recreates any missing index. `DATABASE_TABLE` changes the names (the blob table is always `<name>_blobs`); production uses the defaults. Scratch tables named `contract_test_*` or `qa_*` are test leftovers and need no backup.

A database restore does not restore Worker code or versions, DNS, Wrangler secrets (`BOATSHIP_SECRETS_MASTER_KEY`, provider keys), the Hyperdrive config, Redis contents, email or Composio state, or webhook deliveries already sent. Keep `BOATSHIP_SECRETS_MASTER_KEY` in a separate secure store: provider secrets restored from the database are unreadable without it.

## Taking a backup

### Provider backups (ClickHouse Cloud)

**Unverified.** Whether this Managed PostgreSQL service takes automatic backups, how often, how long they are kept, whether point-in-time recovery exists, and whether a backup restores in place or into a new service have not been checked in the account. An owner must confirm these in the ClickHouse Cloud console (or its API) and record them here with the date checked:

- Backup schedule and retention: _unknown_
- Point-in-time recovery window: _unknown_
- Restore target (new service vs. in place) and typical duration: _unknown_
- Who can trigger a restore, and whether backups survive deleting the service: _unknown_

Until that is recorded, treat the logical dump below as the only backup known to work.

### Logical dump (pg_dump)

Run from an operator machine with PostgreSQL 18 client tools (`pg_dump` must be at least the server's major version). Keep the password out of the command line and shell history: put the connection details in a `~/.pgpass` entry or a `PGPASSWORD` variable set for the one command, never in the runbook or a ticket.

```sh
# Custom format, both tables, compressed. Writes are consistent: pg_dump runs in one snapshot.
pg_dump --format=custom --no-owner --no-privileges \
  --table=public.documents --table=public.documents_blobs \
  --file="boatship-$(date -u +%Y%m%dT%H%M%SZ).dump" \
  "postgresql://<user>@<host>:<port>/<database>?sslmode=require"
pg_restore --list boatship-*.dump   # check both tables and their data are listed
```

- `documents_blobs` dominates the size (uploads are capped at 25 MiB each). Record the dump size and `SELECT count(*) FROM documents` / `documents_blobs` at dump time in the operation log (counts only, no customer data).
- The dump contains customer files, password hashes, and session hashes. Store it encrypted, in an approved region, with access limited to the backup owner, and delete it under the agreed retention.
- Take an extra dump before any risky change (schema-affecting code, bulk scripts such as `scripts/remove-users.mjs`, or a data backfill).
- The direct connection uses TLS but verifies the server certificate only when the service's CA is pinned (`sslmode=verify-full sslrootcert=<ca.pem>` for the CLI, `DATABASE_CA_CERT` for the app). Obtaining that CA certificate is still open.

## Restoring

Never restore over the production tables during a drill. Restore into a new database or service first, validate, and only then decide how to cut over.

```sh
createdb boatship_restore   # or create a new ClickHouse Cloud PostgreSQL service
pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname="postgresql://<user>@<restore-host>:<port>/boatship_restore?sslmode=require" \
  boatship-<stamp>.dump
```

`pg_restore` cannot rename tables, so restoring into the production database alongside the live tables is not possible without first dropping or renaming them. For a real recovery the safer cutover is: restore into a new database, validate it, then point the Hyperdrive config (and `DATABASE_URL` for operator scripts) at it.

After any restore or cutover, start a new Worker version (or otherwise restart every `AppRuntime` instance). Each instance caches the snapshot slices by meta version and memoises sessions for 30 s. Since 2026-10-26 an instance that sees the meta version go *down* (a restore usually has an older version) drops its slice cache and reloads, but if the restored version happens to equal or exceed the cached one the cache cannot tell, so the restart is still required. Also flush Redis or bump `boatship:cache:v1:version` if `REDIS_REST_URL` is set.

## Restore drill checklist (isolated environment only)

1. Record the drill date, the dump or provider backup used, its timestamp, the dump size, and the row counts of both tables at backup time.
2. Restore into a new database or service, never production. Note the elapsed time.
3. Compare row counts (`documents` by `collection`, and `documents_blobs`) against the recorded counts.
4. Check `StoreSnapshot/main` exists and its `version` matches the backup time; parse every `main:*` slice (`SELECT id FROM documents WHERE collection = 'StoreSnapshot'`).
5. Point a staging Worker or a local `next dev` at the restore (scratch secrets only; outbound email, webhooks and Composio disabled) and check: login with a test identity, client and task lists, a document preview and download (bytes come from `documents_blobs`), an assigned-team user seeing only their clients.
6. Decrypt one authorized test provider secret with the preserved `BOATSHIP_SECRETS_MASTER_KEY`.
7. Measure the data gap from the chosen recovery point and the total time; compare with the RPO/RTO once they exist. Log failures, fixes, and the next drill date.
8. Drop the restore database (or keep it under the retention policy), delete local dump copies that are no longer needed, and revoke temporary credentials.

For a real recovery: declare an incident, pause writes and outbound integrations, choose the recovery point with the business owner, restore and validate in isolation, cut over (Hyperdrive config, then a new Worker version), and reconcile tasks, invitations, messages, and webhook deliveries created after the recovery point before resuming delivery. External effects such as emails and webhooks already sent cannot be undone and may be repeated by retries.

## Still unverified

- Every ClickHouse Cloud backup property listed above, and whether the service's own restore works.
- A full `pg_dump`/`pg_restore` round trip of the production tables (size, duration, and that PostgreSQL 18 client tools are available to the operator).
- Connection limits during a large dump, and its effect on live traffic.
- Obtaining and pinning the service's private CA certificate.
- Updating the Hyperdrive config to a new origin during a cutover, and the time it takes.
