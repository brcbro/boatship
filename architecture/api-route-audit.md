# API route audit — 2026-09-25

This audit covers all 99 `app/api/**/route.ts` files in the current working tree. It records the common failure paths found in source and an anonymous local production-build GET sweep. It does not claim that every authenticated mutation or external integration was exercised.

## Coverage

The route inventory spans account (3), auth (5), agent (9), Hodi (4), MCP (5), products (5), tasks (10), clients (6), forms (6), documents (5), Git (4), webhooks (3), integrations (3), and 31 other routes. All 99 route files were scanned for Prisma `$transaction`, `updateMany`, `deleteMany`, and nested relation writes, including calls in shared `lib/` services. The remaining uses of those unsupported primitives in `app/` and `lib/` are zero after this change.

## Findings and fixes

| Failure path | Affected operations | Resolution |
| --- | --- | --- |
| Prisma Neon HTTP adapter rejects transaction start | Snapshot writes, session and secret deletion, notifications, Hodi proposal state changes, repository deactivation | Single conditional Prisma update for the snapshot (already in this working tree); single parameterized SQL statements for bulk/conditional operations. |
| Multi-record writes need atomicity | Product plus owner member, release plus work links, owner transfer, member removal, MCP identity plus project access, related user/client cleanup | Data-changing PostgreSQL CTEs run each group in one SQL statement. |
| Uncaught authorization response became a 500 | Anonymous `GET /api/mcp/audit` | Return the intended 401 response through a route catch. |
| Unhandled logout database failure | `POST /api/auth/logout` | Return a correlated API error if session revocation fails. |

## Verification and limits

- Baseline tests, typecheck, lint, and Next production build passed. Lint had one unused-import warning after the first pass, then the import was removed.
- An initial local production-build anonymous GET sweep called all 99 route paths with placeholder dynamic IDs: 57 returned 401, 3 returned 403, 37 returned 405, 1 returned 200, and `/api/mcp/audit` returned 500. The 500 was traced to a thrown 401 response. A fresh production build and repeat sweep returned 58 401s, 3 403s, 37 405s, and 1 200, with zero 500s or failed requests.
- Read-only `EXPLAIN` against the authorized Neon production database successfully planned all six new multi-record SQL statement shapes. `EXPLAIN` did not execute or change data.
- A uniquely named synthetic write on the operator-authorized production database exercised product/member creation, release/work-link creation and removal, owner transfer, member removal, and MCP identity/access creation. Its cleanup ran in `finally`; a separate read-only query found zero synthetic rows in all six affected tables.
- Cloudflare's historical observability query API returned 403 for the available Wrangler OAuth credential, and live tail produced no captured 500 during this audit. Authenticated API actions, provider callbacks, and deployed Worker behavior have not been fully exercised.
