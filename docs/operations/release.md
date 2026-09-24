# Release, migrations, and rollback

## Before a release

1. Record the candidate Git commit, schema migrations, application owner, and rollback owner. Confirm development, staging, and production use separate Neon databases and Cloudflare configuration and secrets. This separation is a required operating setup; it is not established by the checked-in Wrangler files.
2. Test on staging with a recent sanitized dataset or dedicated test data. Run `npm ci`, focused tests, `npx tsc --noEmit`, lint, `npm run build`, and `npm run cf:dry-run`. Inspect dependency scan findings and any unresolved quality gate failures.
3. Verify required secrets and bindings without printing values: `DATABASE_URL`, `DIRECT_URL` for migrations, `WEBHOOK_ALLOWED_ORIGINS` for approved outbound destinations, `BOATSHIP_SECRETS_MASTER_KEY` where user-managed provider secrets exist, and `MESSAGE_REALTIME_SECRET` where live messages are enabled.
4. Take and verify a recoverable pre-migration backup or provider restore point. Record its timestamp and retention. Check `npx prisma migrate status` against the intended `DIRECT_URL`; review every pending migration and its lock/data impact. The snapshot version and rate-limit migrations must precede the matching app build.

## Promote

1. Apply migrations to staging with `npm run db:deploy`, then run the full staff/client smoke flows: sign-in, assigned-client authorization, invite/reset, task update, document retrieval, message, and webhook delivery to an approved test origin. Verify concurrent snapshot updates and distributed throttles against a disposable database.
2. Obtain the organization's production deployment approval after the tested candidate, migration list, backup checkpoint, and rollback approach are reviewable.
3. Apply production migrations through the controlled deploy process, deploy the exact tested build, run non-destructive smoke checks, and monitor errors/latency, auth failures, database connectivity, and webhook failures. Keep the preceding Worker artifact available for rollback.

## Rollback

If code fails after a backward-compatible migration, redeploy the preceding Worker artifact while preserving the migrated database. Do not assume Prisma has an automatic down migration. If a migration changed data incompatibly, stop writes, assess the recorded restore point, and use the restore runbook to restore into an isolated database before a cutover. Never point an old Worker at a schema it cannot read without a compatibility review. Record the incident and validation results.

`npm run deploy` currently combines migration deployment and Cloudflare deployment. A protected release pipeline and separate staging configuration are still to be implemented; this runbook does not create either one.
