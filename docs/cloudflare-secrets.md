# Hosted secret setup

Boatship never sends provider credentials to the browser. Composio and OpenRouter credentials entered in Integrations are encrypted with AES-256-GCM before they are stored in Neon. The encryption key must exist only in the server deployment environment.

For a Cloudflare deployment, configure these as Wrangler secrets or equivalent encrypted deployment secrets:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put DIRECT_URL
npx wrangler secret put BOATSHIP_SECRETS_MASTER_KEY
```

`BOATSHIP_SECRETS_MASTER_KEY` must be a 32-byte key encoded as either 64 hexadecimal characters or base64. Generate it locally and paste it into the secret prompt; never commit it to `.env.example`, source control, or a public dashboard.

`COMPOSIO_API_KEY` and `OPENROUTER_API_KEY` may remain server-wide fallback secrets, but hosted users should normally enter their own credentials through the secure Integrations panel. Those values are encrypted in Neon and are never returned after submission.

Security rules:

- Do not use `NEXT_PUBLIC_` for any provider credential.
- Do not put credentials in URLs, query strings, logs, client state, or browser storage.
- Rotate `BOATSHIP_SECRETS_MASTER_KEY` only with an explicit re-encryption migration; changing it without re-encrypting makes stored credentials unreadable.
- Use HTTPS for the deployed app and restrict secret-management endpoints to authenticated staff users.
