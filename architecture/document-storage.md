# Neon document content and runtime scaling

Last reviewed: 2026-10-15. Implemented in the working tree; the migration and Worker changes have not been applied to production in this task.

## File content and metadata

The user chose to retain Neon as the file store. `DocumentContent` holds immutable byte records with document/client ownership, type, size, and creation time. `StoreSnapshot.documents` retains current metadata, review/classification/expiry, task/engagement context, and ordered historical metadata containing internal content references. All document JSON responses strip current/history base64 and content IDs; they expose `contentAvailable` to support the viewer. No new Cloudflare R2 binding or public object URL exists.

`POST /api/documents/upload` accepts the existing JSON/base64 upload contract. `lib/document-files.ts` validates a 10 MiB byte limit, bounded filename, strict encoding, reported size, and matching PDF/PNG/JPEG/WebP extension, MIME, and signature. Authorization checks own client or current staff assignment/capability, task visibility, existing document ownership, and an open same-client engagement. The route saves bytes, then `persistDocumentUpload` updates metadata/activity inside the retrying snapshot mutation. Competing replacements append the current committed file; a newer classification, expiry, and context survive the retry. Replacement resets current review to pending.

File save and metadata commit are separate operations. Cleanup after a failed metadata commit first checks fresh current/history references so an uncertain successful commit cannot delete its file. A process crash before metadata commit can leave an orphan; a periodic orphan/retention process is not implemented. Existing missing file references are reported as unavailable and permit replacement. The local demo stores new content at `.data/document-content/<UUID>.bin`; old local base64 records remain readable. Hosted files stay in Neon.

`GET /api/documents/[id]/content` authenticates before reading the ownership-bound byte row. No `version` selects current; `version=0` selects the first history entry. Invalid indexes return 400, missing bytes 404, and unauthorized access 401/403. Responses set private/no-store, nosniff, sandbox policy, safe encoded filename, and verified MIME. Unknown legacy signatures download as octet-stream. One bounded byte range returns 206; unsatisfiable/malformed ranges return 416. The entire byte record is currently read before slicing, so ranges improve transport rather than database memory usage.

`GET /api/documents/[id]` returns metadata. The former metadata-only document POST and PATCH file replacement are rejected with instructions to use uploads. This closes a bypass that could replace references without validated bytes. PATCH remains staff review/classification/expiry; bulk review prevalidates every selected client's authorization and open context before writing. Multi-document review is still separate snapshot commits after prevalidation, rather than one all-or-nothing batch. Client cascade deletion removes relational byte/job rows with the other relational client data after snapshot removal; that existing cross-store cleanup remains separate from the snapshot commit.

The signature checks do not scan malware or fully parse a PDF/image. Malware scanning, retention policy, backup restoration, and complete privacy deletion verification remain separate operational work.

## Migration and release order

`20261014000000_separate_document_content_and_integration_jobs` creates `DocumentContent` and `IntegrationJob`, then copies current and every historical legacy base64 into BYTEA, replaces each inline payload with a deterministic content reference, preserves metadata order, and advances snapshot version. An explicit PostgreSQL transaction and snapshot table lock keep the copy/reference rewrite atomic. Invalid legacy base64 stops and rolls back the migration instead of discarding content.

Verify a recoverable restore point, quiesce legacy writers, apply the migration, then deploy this code. An old application can write inline content again after the lock is released, so writer coordination is required during rollout. The isolated QA fixture executes the real migration against synthetic current/history files; it never reads hosted credentials or customer files. No migration was executed against production here.

## Request scope and application runtimes

`lib/store-context.ts` limits snapshot reuse to an AsyncLocalStorage request scope. `handleApi` and binary retrieval wrap that scope; callers outside it get a fresh `PrismaStore`. Production no longer uses a process-global delivery-store cache. Every mutation reloads current state and uses the existing version check/retry, so separate runtime instances preserve competing writes.

`lib/runtime-routing.ts` hashes a bounded session identifier or anonymous route key into four `app-0`…`app-3` Durable Object names. A session stays on one instance across routes; raw tokens are never used as names. The existing `APP_RUNTIME` binding and class migration suffice. Four instances remove the former single-instance ceiling, but snapshot contention, optional Redis TTL, and each instance's capacity still need a hosted load test. No throughput or latency claim is made from a local build.

The local loopback PostgreSQL adapter shares one Prisma client and a bounded eight-connection Node transport pool, avoiding idle pools and accumulated adapter listeners during tests. Neon HTTP and hosted Hyperdrive retain request-bound client construction.
