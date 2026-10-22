-- Document bytes may live in object storage (R2). A row keeps ownership,
-- type and size either way; exactly one of bytes/objectKey is populated.
ALTER TABLE "DocumentContent" ALTER COLUMN "bytes" DROP NOT NULL;
ALTER TABLE "DocumentContent" ADD COLUMN "objectKey" TEXT;
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_storage_check"
  CHECK (("bytes" IS NOT NULL AND "objectKey" IS NULL) OR ("bytes" IS NULL AND "objectKey" IS NOT NULL));
CREATE INDEX "DocumentContent_objectKey_idx" ON "DocumentContent"("objectKey");
