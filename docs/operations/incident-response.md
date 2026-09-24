# Incident response

Use this for suspected account compromise, data exposure, bad release, database outage, or missing client data. The service owner, security contact, communications owner, escalation channel, and response time have not yet been assigned; record them in the organization's private on-call system before rollout.

1. **Declare and contain.** Record UTC start time, reporter, affected environments and clients, symptoms, and incident lead. Preserve logs and evidence. Limit access or pause risky writes/integrations as needed, while keeping a record of changes.
2. **Assess impact.** Check Cloudflare request/error metrics, application logs, Neon health and migration state, auth sessions, data-change evidence, and webhook delivery records. Determine whether client data, secrets, or external systems are involved. Do not put secrets or customer documents into tickets or chat.
3. **Stabilize.** For a bad Worker release, use the release rollback path. For data loss, use the isolated restore procedure. For compromised credentials, revoke sessions/tokens, rotate affected secrets with an explicit dependency check, and verify no unsafe seed accounts remain. The application does not yet provide a centralized incident kill switch.
4. **Communicate.** The incident lead coordinates updates and any customer or regulator notice under company policy and legal advice. Do not guess impact before evidence is collected; state what is known and when the next update is due.
5. **Recover and learn.** Validate staff/client flows and data integrity, resume integrations carefully, close only after monitoring remains stable, then record timeline, root cause, follow-up owner, and due date.

Required dashboards, alerts, audit retention, and on-call integration are still open implementation work. This runbook is a starting procedure rather than proof that those controls exist.
