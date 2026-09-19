# Boatship — Client Onboarding System

Web app for managing client onboarding: team/admin manage clients, tasks, documents, and forms; clients complete a self-service checklist.

## Stack

- Next.js (App Router) + Tailwind CSS
- Neon PostgreSQL + Prisma ORM for application data, users, sessions, and integration ownership
- Resend for transactional email (logs to console without `RESEND_API_KEY`)
- Composio for 250+ app integrations (Slack, Gmail, Drive, HubSpot, …)
- Cloudflare Pages via OpenNext (`@opennextjs/cloudflare`)

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Initial accounts

Create the first administrator through your private seed or provisioning process. Default demo credentials are not displayed or enabled in hosted/production mode. Client accounts should sign in using their invitation or password-reset link.

## Core flows

1. Sign in as admin → **Clients** → **New client** (tasks auto-seed from Standard Onboarding)
2. Open client → **Invite client** → copy temp password
3. Sign out → sign in as client → complete tasks, submit form, upload documents
4. Sign in as admin → review documents/forms, update task status, check **Activity** / **Analytics**
5. Optional: **Integrations** → each member securely saves their own Composio/OpenRouter credentials → connect **Google Drive** and open **Hodi**
6. Optional: connect Slack → set `COMPOSIO_SLACK_CHANNEL` for auto-notify

## Environment

Copy `.env.example` to `.env.local` and set the pooled Neon `DATABASE_URL` plus direct `DIRECT_URL`.
Run `npm run db:push` once to create the Prisma schema in Neon. The application refuses to use the local file store unless `ALLOW_LOCAL_STORE=1` is explicitly set for demo-only work.
If you have existing demo data, run `npm run db:import-local` once after `db:push` to move `.data/store.json` into Neon.

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
