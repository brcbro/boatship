CREATE TABLE "public"."Engagement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ownerId" TEXT,
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Engagement_clientId_status_idx" ON "public"."Engagement"("clientId", "status");
CREATE INDEX "Engagement_ownerId_idx" ON "public"."Engagement"("ownerId");

CREATE TABLE "public"."ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientContact_clientId_email_key" ON "public"."ClientContact"("clientId", "email");
CREATE INDEX "ClientContact_clientId_idx" ON "public"."ClientContact"("clientId");

INSERT INTO "public"."Engagement" ("id", "clientId", "name", "type", "status", "ownerId", "completedAt", "createdAt", "updatedAt")
SELECT 'onboarding_' || client->>'id', client->>'id', 'Onboarding', 'onboarding',
    CASE client->>'status'
      WHEN 'completed' THEN 'completed'
      WHEN 'on_hold' THEN 'paused'
      WHEN 'in_progress' THEN 'active'
      ELSE 'planned'
    END,
    NULLIF(client->>'assignedTeamMemberId', ''),
    CASE WHEN client->>'status' = 'completed' AND client->>'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (client->>'updatedAt')::timestamp ELSE NULL END,
    CASE WHEN client->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (client->>'createdAt')::timestamp ELSE CURRENT_TIMESTAMP END,
    CASE WHEN client->>'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (client->>'updatedAt')::timestamp ELSE CURRENT_TIMESTAMP END
FROM "public"."StoreSnapshot" snapshot,
     jsonb_array_elements(COALESCE(snapshot."data"->'clients', '[]'::jsonb)) client
WHERE snapshot."id" = 'main' AND client ? 'id'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "public"."ClientContact" ("id", "clientId", "name", "email", "role", "updatedAt")
SELECT 'primary_' || client->>'id', client->>'id', COALESCE(NULLIF(client->>'name', ''), 'Primary contact'),
       lower(client->>'primaryContactEmail'), 'account_admin', CURRENT_TIMESTAMP
FROM "public"."StoreSnapshot" snapshot,
     jsonb_array_elements(COALESCE(snapshot."data"->'clients', '[]'::jsonb)) client
WHERE snapshot."id" = 'main' AND client ? 'id' AND NULLIF(client->>'primaryContactEmail', '') IS NOT NULL
ON CONFLICT ("clientId", "email") DO NOTHING;
