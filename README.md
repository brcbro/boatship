# Boatship — Client Onboarding System

Web app for managing client onboarding: team/admin manage clients, tasks, documents, and forms; clients complete a self-service checklist.

## Stack

- Next.js (App Router) + Tailwind CSS
- Neon PostgreSQL + Prisma ORM for application data, users, sessions, and integration ownership
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

1. Sign in as admin → **Clients** → **New client** (tasks auto-seed from Standard Onboarding)
2. Open client → **Invite client** → the client receives a one-time password setup link by email
3. The client sets their password, signs in, completes tasks, submits forms, and uploads documents
4. Sign in as admin → review documents/forms, update task status, check **Activity** / **Analytics**
5. Optional: **Integrations** → each member securely saves their own Composio/OpenRouter credentials → connect **Google Drive** and open **Hodi**
6. Optional: connect Slack → set `COMPOSIO_SLACK_CHANNEL` for auto-notify

Hosted email delivery uses `ZEPTOMAIL_API_KEY` and a verified `ZEPTOMAIL_FROM` sender, or `RESEND_API_KEY` and `RESEND_FROM`. ZeptoMail takes priority when both are configured. The API returns an error when delivery is unavailable instead of reporting a demo send.

## Environment

Copy `.env.example` to `.env.local` and set the pooled Neon `DATABASE_URL` plus direct `DIRECT_URL`.
Run `npm run db:deploy` to apply reviewed Prisma migrations to the intended Neon database. The application refuses to use the local file store unless `ALLOW_LOCAL_STORE=1` is explicitly set for demo-only work.
Keep demo data in explicit `ALLOW_LOCAL_STORE=1` mode. The old `db:import-local` shortcut is retired because it could replace populated data and import fixed demo credentials; see the [operations runbooks](docs/operations/README.md) before planning a reviewed data migration.

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

### Optional Cloudflare Hyperdrive

Production can use Hyperdrive to avoid opening a full PostgreSQL connection to Neon for every
Worker request. Create a Hyperdrive configuration with the direct Neon connection string, then
uncomment the `[[hyperdrive]]` example in `wrangler.toml` and replace its placeholder with the real
configuration ID. The application automatically uses the `HYPERDRIVE` binding on Cloudflare and
keeps using the pooled `DATABASE_URL` with the Neon HTTP adapter during local `next dev` runs.

Do not put a database URL or Hyperdrive ID into application source code. Keep `DATABASE_URL` as a
Worker secret for fallback and maintenance tasks. Run `npm run cf:dry-run` before deployment to
build the OpenNext output, prune unused static assets, and validate the Worker without uploading it.

### Optional Redis cache

Set `REDIS_REST_URL` and `REDIS_REST_TOKEN` to an Upstash Redis REST database to cache the
analytics endpoint for 60 seconds. Every successful datastore write advances a cache generation,
so cached analytics are immediately bypassed after a mutation. Redis is optional and cache outages
fall back to Neon without affecting requests. Keep these values as Worker secrets; do not expose
them with a `NEXT_PUBLIC_` prefix.

### Live messages

Live conversations use a Cloudflare Durable Object with short-lived, server-authorized WebSocket
tickets. Before deploying, set `MESSAGE_REALTIME_SECRET` as a Worker secret (a long random value)
and in local `.env.local` when testing through a Cloudflare Worker preview. Without it, the message
pages continue using their polling fallback.

## Security rules

Server API routes enforce RBAC. Each authenticated Boatship user gets an isolated Composio user namespace (`boatship_<userId>`), and connected-account ownership is also recorded in Neon.
