BEGIN;
-- Keep every backfill read and the reference rewrite on one snapshot version.
LOCK TABLE "StoreSnapshot" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "DocumentContent" (
  "id" TEXT PRIMARY KEY, "documentId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL, "contentType" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DocumentContent_documentId_idx" ON "DocumentContent"("documentId");
CREATE INDEX "DocumentContent_clientId_idx" ON "DocumentContent"("clientId");

CREATE TABLE "IntegrationJob" (
  "id" TEXT PRIMARY KEY, "dedupKey" TEXT NOT NULL UNIQUE,
  "clientId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMPTZ(3), "leaseToken" TEXT, "error" TEXT, "result" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "IntegrationJob_status_nextAttemptAt_idx" ON "IntegrationJob"("status", "nextAttemptAt");
CREATE INDEX "IntegrationJob_clientId_createdAt_idx" ON "IntegrationJob"("clientId", "createdAt");
CREATE INDEX "IntegrationJob_actorId_createdAt_idx" ON "IntegrationJob"("actorId", "createdAt");

-- Preserve existing current bytes and every historical version before removing
-- them from JSON. The explicit transaction rolls back all work on bad data.
INSERT INTO "DocumentContent" ("id", "documentId", "clientId", "bytes", "contentType", "size")
SELECT 'legacy:' || (d->>'id') || ':current', d->>'id', d->>'clientId',
  decode(regexp_replace(d->>'contentBase64', '^data:[^,]*,', ''), 'base64'),
  COALESCE(d->>'contentType', 'application/octet-stream'),
  octet_length(decode(regexp_replace(d->>'contentBase64', '^data:[^,]*,', ''), 'base64'))
FROM "StoreSnapshot", LATERAL jsonb_array_elements(COALESCE(data->'documents', '[]'::jsonb)) d
WHERE "StoreSnapshot".id = 'main' AND COALESCE(d->>'contentBase64', '') <> '';

INSERT INTO "DocumentContent" ("id", "documentId", "clientId", "bytes", "contentType", "size")
SELECT 'legacy:' || (d->>'id') || ':version:' || (v.ordinality - 1)::text,
  d->>'id', d->>'clientId',
  decode(regexp_replace(v.item->>'contentBase64', '^data:[^,]*,', ''), 'base64'),
  COALESCE(v.item->>'contentType', 'application/octet-stream'),
  octet_length(decode(regexp_replace(v.item->>'contentBase64', '^data:[^,]*,', ''), 'base64'))
FROM "StoreSnapshot", LATERAL jsonb_array_elements(COALESCE(data->'documents', '[]'::jsonb)) d,
  LATERAL jsonb_array_elements(COALESCE(d->'versions', '[]'::jsonb)) WITH ORDINALITY v(item, ordinality)
WHERE "StoreSnapshot".id = 'main' AND COALESCE(v.item->>'contentBase64', '') <> '';

UPDATE "StoreSnapshot" s SET data = jsonb_set(s.data, '{documents}', COALESCE((
  SELECT jsonb_agg((d - 'contentBase64') ||
    CASE WHEN COALESCE(d->>'contentBase64', '') <> ''
      THEN jsonb_build_object('contentId', 'legacy:' || (d->>'id') || ':current') ELSE '{}'::jsonb END ||
    jsonb_build_object('versions', COALESCE((
      SELECT jsonb_agg((v.item - 'contentBase64') ||
        CASE WHEN COALESCE(v.item->>'contentBase64', '') <> '' THEN
          jsonb_build_object('contentId', 'legacy:' || (d->>'id') || ':version:' || (v.ordinality - 1)::text)
          ELSE '{}'::jsonb END ORDER BY v.ordinality)
      FROM jsonb_array_elements(COALESCE(d->'versions', '[]'::jsonb)) WITH ORDINALITY v(item, ordinality)
    ), '[]'::jsonb)) ORDER BY ordinality)
  FROM jsonb_array_elements(COALESCE(s.data->'documents', '[]'::jsonb)) WITH ORDINALITY docs(d, ordinality)
), '[]'::jsonb)), version = version + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE s.id = 'main';

COMMIT;
