# Boatship operations

These runbooks describe repository-supported actions. They are not evidence that any hosted environment, backup, monitoring rule, or recovery target has been configured or tested. Keep a dated operation log outside source control, without secrets or customer data.

| Runbook | When to use |
| --- | --- |
| [First administrator](first-admin.md) | Start a new migrated database with one private admin. |
| [Release and migrations](release.md) | Promote a tested build through staging and production. |
| [Backup and restore](backup-restore.md) | Design and rehearse a database restore. |
| [Incident response](incident-response.md) | Handle suspected compromise, outage, or data loss. |

Before production rollout, assign a named service owner and backup, set an on-call channel, and record approved recovery point and recovery time objectives. Those choices are currently undecided.

The legacy `db:import-local`, `create-team-users.mjs`, and `promote-admin-users.mjs` account/data shortcuts are retired. They could overwrite the populated snapshot or import fixed demo credentials. Keep local demo data in explicit `ALLOW_LOCAL_STORE=1` mode. If historical data must enter a hosted database, plan a reviewed import that synchronizes relational identity tables, rejects demo credentials, and uses a version-aware write against an empty or explicitly selected target.
