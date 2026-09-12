# Git provider integration

Boatship accepts GitHub and GitLab webhook deliveries at:

- `POST /api/webhooks/git/github`
- `POST /api/webhooks/git/gitlab`

The existing compatibility path `/api/git/webhooks/:provider` remains available.

## Webhook security

Webhook requests are verified against the exact request body before any evidence is written. Configure a raw secret in the deployment environment; Boatship fails closed with `503` when no secret is configured and returns `401` for an invalid signature.

Secrets may be scoped to a repository with `BOATSHIP_GITHUB_WEBHOOK_SECRET_OWNER_REPOSITORY` or `BOATSHIP_GITLAB_WEBHOOK_SECRET_OWNER_REPOSITORY` (non-alphanumeric characters become `_` and the value is uppercased), or shared per provider with `BOATSHIP_GITHUB_WEBHOOK_SECRET` / `BOATSHIP_GITLAB_WEBHOOK_SECRET`. `BOATSHIP_GIT_WEBHOOK_SECRET` is the final shared fallback.

- GitHub: `X-Hub-Signature-256: sha256=<HMAC-SHA256(body)>` using the raw secret.
- GitLab: `X-Gitlab-Token: <raw secret>` is checked in constant time. `X-Gitlab-Signature: sha256=<HMAC-SHA256(body)>` is also accepted for proxy setups.

The `webhookSecret` field accepted by the repository creation API is retained as a legacy hash marker for compatibility. It is not used as an HMAC key; configure the raw deployment secret above and rotate old webhook secrets when enabling this hardened path.

## Normalization and idempotency

GitHub `X-GitHub-Event` / `X-GitHub-Delivery` and GitLab `X-GitLab-Event` / `X-GitLab-Event-UUID` are normalized into a common event shape. If a provider omits a delivery ID, Boatship derives a deterministic request fingerprint.

The delivery key is stored as `delivery:<id>` in Git evidence. Replayed deliveries return the original evidence ID and do not create another evidence or validation record.

## Provider API synchronization

`POST /api/git/repositories/:id` currently returns a typed sync plan with `not_configured` status. It intentionally performs no provider API call until a GitHub App/OAuth installation or GitLab application token reference is configured. No credentials are invented, logged, or returned by the API. This is the extension point for repository metadata, checks, reviews, and deployment synchronization.
