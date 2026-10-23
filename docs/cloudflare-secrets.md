# Hosted secret setup

Boatship never sends provider credentials to the browser. Composio and OpenRouter credentials entered in Integrations are encrypted with AES-256-GCM before they are stored in the database. The encryption key must exist only in the server deployment environment.

For a Cloudflare deployment, configure these as Wrangler secrets or equivalent encrypted deployment secrets:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put BOATSHIP_SECRETS_MASTER_KEY
npx wrangler secret put FIREBASE_STORAGE_BUCKET
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

`DATABASE_URL` is the PostgreSQL connection string of the ClickHouse Cloud service and is the system of record for data and file bytes, so treat the password as a production secret. On Cloudflare the Worker does not use it directly: the service's certificate is privately signed, so a Hyperdrive config created with `npx wrangler hyperdrive create boatship-db --caching-disabled --connection-string="<DATABASE_URL>?sslmode=require"` and bound as `HYPERDRIVE` in `wrangler.production.toml` carries the connection. Keep caching disabled. The three Firebase secrets are only needed for the Firestore fallback and can be left unset.

`FIREBASE_STORAGE_BUCKET` is the Firebase project's default bucket name (for example `project-id.appspot.com`). `FIREBASE_SERVICE_ACCOUNT` is the complete service-account JSON from the Firebase console, pasted as one line, or only its PEM private key with the account's email in `FIREBASE_CLIENT_EMAIL`; the account needs the Storage Object Admin role on that bucket. The Worker signs a short-lived RS256 assertion with it and never exposes it to the browser. When both are unset, document bytes stay in the database.

For hosted transactional mail, set `ZEPTOMAIL_API_KEY` and `ZEPTOMAIL_FROM` (a full verified, general-purpose sender address). The app uses Zoho's India CPaaS HTTPS API. Existing Resend deployments can use `RESEND_API_KEY` and `RESEND_FROM` instead. The shared mail function selects the display name by message type: Boatship, Boatship Team, or Boatship Updates. Do not use an onboarding-specific address for this shared Client OS stream. Verify the replacement address in the provider, change the Worker secret, and send a controlled test message before releasing mail-dependent routes. Sender secret values must not be committed.

`BOATSHIP_SECRETS_MASTER_KEY` must be a 32-byte key encoded as either 64 hexadecimal characters or base64. Generate it locally and paste it into the secret prompt; never commit it to `.env.example`, source control, or a public dashboard.

`COMPOSIO_API_KEY` and `OPENROUTER_API_KEY` may remain server-wide fallback secrets, but hosted users should normally enter their own credentials through the secure Integrations panel. Those values are encrypted in the database and are never returned after submission.

Configure `WEBHOOK_ALLOWED_ORIGINS` as a comma-separated list of exact HTTPS origins before enabling outbound webhooks. An empty value disables new destinations and delivery. Review ownership of each approved domain before adding it. Rotate older webhook signing secrets that may have been exposed through previous API responses.

The database needs no migration step; `npm run deploy` builds and uploads the Worker. `npm run firestore:indexes` only matters when the Firestore fallback is in use.

OpenNext copies every `.env*` value into the Worker bundle at build time. `scripts/scrub-env-bundle.mjs` (part of `npm run build:cloudflare`) removes everything except `NEXT_PUBLIC_*` and a short allowlist of non-secret keys, so hosted secrets must be set with `node scripts/worker-secrets.mjs` or `wrangler secret put`; a local `.env.local` value never reaches production on its own.

Security rules:

- Do not use `NEXT_PUBLIC_` for any provider credential.
- Do not put credentials in URLs, query strings, logs, client state, or browser storage.
- Rotate `BOATSHIP_SECRETS_MASTER_KEY` only with an explicit re-encryption migration; changing it without re-encrypting makes stored credentials unreadable.
- Use HTTPS for the deployed app and restrict secret-management endpoints to authenticated staff users.
