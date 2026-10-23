# Boatship — Client OS

Shared workspace for client accounts and their engagements. Staff manage work, documents, forms, approvals, and communication; clients see their own next steps and history.

## Stack

- Next.js (App Router) + Tailwind CSS
- PostgreSQL on ClickHouse Cloud for application data, users, sessions, and integration ownership (JSON documents in one table); Firebase Storage for document files
- Zoho CPaaS / ZeptoMail or Resend for transactional email (local demo logs to console without a provider; hosted mode requires a provider key and verified sender)
- Composio for 250+ app integrations (Slack, Gmail, Drive, HubSpot, …)
- Cloudflare Worker via OpenNext (`@opennextjs/cloudflare`)

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Initial accounts

For a new migrated database, use the guarded [first-admin provisioning runbook](docs/operations/first-admin.md). Existing environments use authenticated account management. Default demo credentials are not enabled in hosted/production mode. Client accounts sign in using their invitation or password-reset link.

## Core flows

1. Sign in as admin → **Clients** → **New client** (the current creation flow seeds a Standard Onboarding engagement)
2. Open client → **Invite client** → the client receives a one-time password setup link by email
3. The client sets their password, signs in, completes tasks, submits forms, and uploads documents
4. Sign in as admin → review documents/forms, update task status, check **Activity** / **Analytics**
5. Optional: **Integrations** → each member securely saves their own Composio/OpenRouter credentials → connect **Google Drive** and open **Hodi**
6. Optional: connect Slack → set `COMPOSIO_SLACK_CHANNEL` for auto-notify

Hosted email delivery uses `ZEPTOMAIL_API_KEY` and a verified general-purpose `ZEPTOMAIL_FROM` address, or `RESEND_API_KEY` and `RESEND_FROM`. ZeptoMail takes priority when both are configured. Client messages display as Boatship, team invitations as Boatship Team, and digests as Boatship Updates. The API returns an error when delivery is unavailable instead of reporting a demo send. Do not configure an onboarding-specific sender address for the shared Client OS mail stream.

## Environment

Copy `.env.example` to `.env.local` and set `DATABASE_URL` (the PostgreSQL connection string) plus `FIREBASE_SERVICE_ACCOUNT` (the service-account JSON, or its PEM key with `FIREBASE_CLIENT_EMAIL`) and `FIREBASE_STORAGE_BUCKET` for file storage. The database needs no schema migration; the `documents` table is created on first use. The application refuses to use the local file store unless `ALLOW_LOCAL_STORE=1` is explicitly set for demo-only work.
Keep demo data in explicit `ALLOW_LOCAL_STORE=1` mode. The old `db:import-local` shortcut is retired because it could replace populated data and import fixed demo credentials; see the [operations runbooks](docs/operations/README.md) before planning a reviewed data migration. Operator scripts run with `node --import tsx` (for example `node --import tsx scripts/provision-first-admin.mjs --expect-project boatship-main`).

Passwords are stored as scrypt hashes, and login sessions are opaque database records with hashed tokens.

### Composio + Hodi

1. Get an API key at [app.composio.dev](https://app.composio.dev)
2. Set `COMPOSIO_API_KEY` and an LLM key in `.env.local`. OpenRouter is preferred when `OPENROUTER_API_KEY` is set and defaults to `openrouter/free`, which selects an available free model with the needed capabilities; direct OpenAI and AI Gateway remain supported.
3. Open **Integrations** → connect **Google Drive** (OAuth is per signed-in team member)
4. Open **Hodi** to chat against your Drive (create client folders, search files, etc.)
5. Optionally set `COMPOSIO_SLACK_CHANNEL` so client create / invite / task complete / onboarding complete post to Slack

Curated toolkits are listed in the UI; Composio’s catalog covers 250+ apps — add more slugs in `lib/composio.ts` as needed.

## Deploy (Cloudflare)

```bash
npm run deploy
```

Configure the same secrets in Cloudflare Pages / Workers.

### Document files in Firebase Storage

Set `FIREBASE_STORAGE_BUCKET` and `FIREBASE_SERVICE_ACCOUNT` (see `docs/cloudflare-secrets.md`). With both
present, new uploads are stored in the Firebase Storage bucket through the Google Cloud Storage JSON
API and only their ownership record stays in the database; without them (local `next dev`, tests),
bytes stay in the `DocumentContent` row. The server uses the service account directly, so
`storage.rules` does not govern these objects. Existing row-stored files move in
batches with `POST /api/internal/document-content-migrate?limit=5` using the `x-boatship-cron-secret`
header; repeat until the response reports `remaining: 0`.

### Database access and tests

All data access goes through the storage interface in `lib/firestore/`, implemented for PostgreSQL
(`DATABASE_URL`, production), the Firestore REST API (fallback and emulator tests), and memory.
`npm run test:postgres` runs the storage contract against `DATABASE_URL` in a scratch table, and
`npm run test:e2e:postgres` runs the end-to-end suite the same way with `QA_DATABASE_URL` set.
`npm run test:e2e` and `npm run local-qa` start the Firestore
emulator (Java 11+ required) and seed an isolated fixture; `npm run test:firestore` runs the client
contract against the emulator. Run `npm run cf:dry-run` before deployment to build the OpenNext
output, prune unused static assets, and validate the Worker without uploading it.

### Optional Redis cache

Set `REDIS_REST_URL` and `REDIS_REST_TOKEN` to an Upstash Redis REST database to cache the
analytics endpoint for 60 seconds. Every successful datastore write advances a cache generation,
so cached analytics are immediately bypassed after a mutation. Redis is optional and cache outages
fall back to Firestore without affecting requests. Keep these values as Worker secrets; do not expose
them with a `NEXT_PUBLIC_` prefix.

### Live messages

Live conversations use a Cloudflare Durable Object with short-lived, server-authorized WebSocket
tickets. Before deploying, set `MESSAGE_REALTIME_SECRET` as a Worker secret (a long random value)
and in local `.env.local` when testing through a Cloudflare Worker preview. Without it, the message
pages continue using their polling fallback.

## Security rules

Server API routes enforce RBAC. Each authenticated Boatship user gets an isolated Composio user namespace (`boatship_<userId>`), and connected-account ownership is also recorded in the database.
