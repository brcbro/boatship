# Boatship MCP clients

Boatship exposes a per-user MCP endpoint over Streamable HTTP:

```text
https://<boatship-host>/api/mcp
```

Each user gets a unique public MCP ID and token. An authenticated Boatship user can issue a token for themselves:

```http
POST https://<boatship-host>/api/mcp/identities
Authorization: Bearer <boatship-session-token>
Content-Type: application/json

{
  "scopes": ["tasks:read", "projects:read", "context:read"],
  "projectIds": ["<project-id>"]
}
```

An admin may also include `"userId": "<target-user-id>"` to issue a token for another user. The response contains `publicId` and the raw `token` exactly once. Store the token in the client’s secret store immediately; Boatship stores only a hash and cannot display it again.

## MCP request headers

Send both headers to the MCP endpoint:

```http
Authorization: Bearer <mcp-token>
x-boatship-mcp-id: <mcp-public-id>
```

Boatship verifies the hashed token, requires an active non-revoked identity, checks the public ID, and updates `lastUsedAt`. The token’s scopes are carried with the identity and are never returned as credentials.

Default scopes are:

```text
tasks:read
projects:read
context:read
```

Git-based progress validation requires the `git:validate` scope. Validation must use repository evidence such as commits, diffs, and checks; agent-written summaries are not treated as proof.

## Client configuration examples

Use the client’s secret/environment-variable facility for `<mcp-token>`.

### Codex

```toml
[mcp_servers.boatship]
url = "https://<boatship-host>/api/mcp"

[mcp_servers.boatship.headers]
Authorization = "Bearer <mcp-token>"
x-boatship-mcp-id = "<mcp-public-id>"
```

### Claude Code

```bash
claude mcp add --transport http boatship https://<boatship-host>/api/mcp \
  --header "Authorization: Bearer <mcp-token>" \
  --header "x-boatship-mcp-id: <mcp-public-id>"
```

### Cursor

```json
{
  "mcpServers": {
    "boatship": {
      "url": "https://<boatship-host>/api/mcp",
      "headers": {
        "Authorization": "Bearer <mcp-token>",
        "x-boatship-mcp-id": "<mcp-public-id>"
      }
    }
  }
}
```

### Antigravity and other Streamable HTTP clients

Add a remote MCP server using:

```json
{
  "name": "boatship",
  "url": "https://<boatship-host>/api/mcp",
  "headers": {
    "Authorization": "Bearer <mcp-token>",
    "x-boatship-mcp-id": "<mcp-public-id>"
  }
}
```

The exact settings location varies by client. Do not commit tokens to source control, prompts, task descriptions, or shared configuration files.

## Revocation

The owning user or an admin can revoke an identity. The public ID is safe to reference; the token is not.

```http
DELETE https://<boatship-host>/api/mcp/identities?publicId=<mcp-public-id>
Authorization: Bearer <boatship-session-token>
```

`PATCH /api/mcp/identities` with `{ "publicId": "<mcp-public-id>" }` provides the same revoke operation.
