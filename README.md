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

| Role  | Email                   | Password     |
|-------|-------------------------|--------------|
| Admin | admin@boatship.local    | admin123     |
| Team  | team@boatship.local     | team123      |
| Client| (after invite)          | Welcome123!  |

## Core flows

1. Sign in as admin → **Clients** → **New client** (tasks auto-seed from Standard Onboarding)
2. Open client → **Invite client** → copy temp password
3. Sign out → sign in as client → complete tasks, submit form, upload documents
4. Sign in as admin → review documents/forms, update task status, check **Activity** / **Analytics**
5. Optional: **Integrations** → each member connects **Google Drive** (needs `COMPOSIO_API_KEY`) → open **Hodi** (`OPENROUTER_API_KEY`) to list or create folders
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

## Security rules

Server API routes enforce RBAC. Each authenticated Boatship user gets an isolated Composio user namespace (`boatship_<userId>`), and connected-account ownership is also recorded in Neon.
