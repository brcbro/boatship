# First administrator

`scripts/provision-first-admin.mjs` creates exactly one administrator in a freshly migrated environment. It checks both `StoreSnapshot` and `UserProfile` for an existing admin or matching email, and conditionally updates the snapshot version while inserting the profile in the same SQL statement. A concurrent snapshot change makes the command fail; inspect the state and retry. The command will not rotate or promote an existing account.

1. Apply reviewed Prisma migrations to the intended database. Verify that `StoreSnapshot` includes `version` and `UserProfile` exists. Confirm the target database is isolated from other environments.
2. Set `DIRECT_URL`, `BOATSHIP_ADMIN_EMAIL`, `BOATSHIP_ADMIN_NAME`, and `BOATSHIP_ADMIN_PASSWORD` only in the command's private process environment. Use a unique password of at least 16 characters from an approved password manager. Do not put credentials in a command line, shell history, issue, or repository file. The script does not load `.env.local` automatically.
3. Run `node scripts/provision-first-admin.mjs --expect-host <exact-database-host>` to inspect eligibility. The host must match the hostname in `DIRECT_URL`; the command prints no URL or password.
4. Verify the target and run `node scripts/provision-first-admin.mjs --expect-host <exact-database-host> --apply` once. Clear the process environment variables after use.
5. Sign in through the application and verify admin access. Invite other staff through the authenticated invitation workflow; do not share the bootstrap account.

If the command reports an existing admin, stop. On an older database this may be a fixed demo account. Inventory both storage layers and current sessions, then use an approved, backed-up account-remediation procedure to disable or rotate that account. This bootstrap script intentionally will not erase, promote, or reset existing identities.

The old `promote-admin-users.mjs` and `create-team-users.mjs` shortcuts are retired because they could overwrite concurrent snapshot writes; team accounts must be invited in the app. This process does not provide MFA or SSO. The identity provider remains undecided.
