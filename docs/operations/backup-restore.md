# Backup, restore, and recovery exercise

**Decision pending:** the business owner has not set an RPO (maximum acceptable data loss) or RTO (maximum acceptable outage). Choose both with the owner before selecting backup frequency, retention, restore method, and alert thresholds. Record the database region and any residency restrictions.

## Coverage

The Neon database contains `StoreSnapshot` (including application documents and versions), normalized user profiles/sessions/notifications, product and integration tables, audit-related tables, and rate-limit buckets. Separate configuration and secrets live outside Neon in Cloudflare and provider accounts. A database restore alone does not restore Worker code, DNS, encryption keys, Resend/Composio state, or external webhook deliveries. Preserve `BOATSHIP_SECRETS_MASTER_KEY` securely for restored encrypted provider secrets; rotating it requires re-encryption.

## Backup policy to establish

Assign an owner to verify the provider's available point-in-time restore or export capability, retention, access controls, and alerting in the actual account. Keep backup access separate from daily app permissions. Capture an additional recovery point before schema changes. Document storage encryption, region, and deletion/retention obligations. Record objective evidence of a successful restore, not just a successful backup job.

## Restore drill (isolated environment only)

1. Pick a dated recovery point and record the data scope, schema version, and expected row counts without copying customer data into the runbook.
2. Restore to a new, isolated database/branch. Never overwrite the production database during a drill. Connect a staging Worker configured only with staging secrets and disabled or test-only outbound integrations.
3. Verify migrations and schema, `StoreSnapshot.version`, user profiles, client/task/document counts, representative document retrieval, and login with test identities. Check provider-secret decryption only with an authorized test record. Validate assigned-client access and the absence of unexpected cross-client data.
4. Measure elapsed restoration time and actual data gap from the selected point. Compare with approved RTO/RPO once set. Log failures, remediation, and the next drill date.
5. Destroy or retain the isolated restore under the approved retention policy, then revoke temporary credentials.

For a real recovery, declare an incident, pause writes/outbound integrations, choose a recovery point with the business owner, restore and validate in isolation, then approve a controlled traffic cutover. Reconcile any tasks, invitations, messages, and webhook deliveries created after the recovery point before resuming delivery; duplicate external effects require special care.
