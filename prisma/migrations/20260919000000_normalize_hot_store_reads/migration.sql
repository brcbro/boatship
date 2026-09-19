-- Move the two highest-frequency StoreSnapshot collections into indexed
-- relational tables. The INSERT statements preserve existing production data
-- and make the application cut-over safe in the same deployment as this
-- migration. StoreSnapshot remains in place for rollback compatibility.

CREATE TABLE "UserProfile" (
    "uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "inviteToken" TEXT,
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "passwordHash" TEXT,
    "permissions" TEXT[] NOT NULL,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastDigestAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("uid")
);

CREATE INDEX "UserProfile_email_idx" ON "UserProfile"("email");
CREATE INDEX "UserProfile_inviteToken_idx" ON "UserProfile"("inviteToken");
CREATE INDEX "UserProfile_role_idx" ON "UserProfile"("role");
CREATE INDEX "UserProfile_clientId_idx" ON "UserProfile"("clientId");

CREATE TABLE "NotificationRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "clientId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationRecord_userId_createdAt_idx"
    ON "NotificationRecord"("userId", "createdAt");
CREATE INDEX "NotificationRecord_userId_readAt_idx"
    ON "NotificationRecord"("userId", "readAt");
CREATE INDEX "NotificationRecord_clientId_idx"
    ON "NotificationRecord"("clientId");

-- Backfill users from the existing typed JSON store. Emails are normalized to
-- match the application's login semantics. Invalid/missing optional values stay
-- null instead of blocking the cut-over.
INSERT INTO "UserProfile" (
    "uid",
    "email",
    "name",
    "role",
    "clientId",
    "createdAt",
    "inviteToken",
    "inviteTokenExpiresAt",
    "mustResetPassword",
    "password",
    "passwordHash",
    "permissions",
    "digestEnabled",
    "lastDigestAt",
    "updatedAt"
)
SELECT
    user_json->>'uid',
    lower(COALESCE(user_json->>'email', '')),
    COALESCE(user_json->>'name', ''),
    COALESCE(user_json->>'role', 'team'),
    NULLIF(user_json->>'clientId', ''),
    COALESCE(NULLIF(user_json->>'createdAt', '')::TIMESTAMP(3), CURRENT_TIMESTAMP),
    NULLIF(user_json->>'inviteToken', ''),
    NULLIF(user_json->>'inviteTokenExpiresAt', '')::TIMESTAMP(3),
    COALESCE((user_json->>'mustResetPassword')::BOOLEAN, false),
    NULLIF(user_json->>'password', ''),
    NULLIF(user_json->>'passwordHash', ''),
    ARRAY(
        SELECT jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(user_json->'permissions') = 'array'
                    THEN user_json->'permissions'
                ELSE '[]'::jsonb
            END
        )
    ),
    COALESCE((user_json->>'digestEnabled')::BOOLEAN, false),
    NULLIF(user_json->>'lastDigestAt', '')::TIMESTAMP(3),
    CURRENT_TIMESTAMP
FROM "StoreSnapshot" snapshot
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(snapshot."data"->'users') = 'array'
            THEN snapshot."data"->'users'
        ELSE '[]'::jsonb
    END
) AS users(user_json)
WHERE snapshot."id" = 'main'
  AND COALESCE(user_json->>'uid', '') <> ''
ON CONFLICT ("uid") DO NOTHING;

-- Backfill notifications before reads switch to the new index. No foreign key
-- is added intentionally: old notifications survive deleted users today and
-- must not make this migration fail.
INSERT INTO "NotificationRecord" (
    "id",
    "userId",
    "kind",
    "title",
    "body",
    "href",
    "clientId",
    "readAt",
    "createdAt"
)
SELECT
    notification_json->>'id',
    notification_json->>'userId',
    COALESCE(notification_json->>'kind', 'system'),
    COALESCE(notification_json->>'title', ''),
    COALESCE(notification_json->>'body', ''),
    NULLIF(notification_json->>'href', ''),
    NULLIF(notification_json->>'clientId', ''),
    NULLIF(notification_json->>'readAt', '')::TIMESTAMP(3),
    COALESCE(NULLIF(notification_json->>'createdAt', '')::TIMESTAMP(3), CURRENT_TIMESTAMP)
FROM "StoreSnapshot" snapshot
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(snapshot."data"->'notifications') = 'array'
            THEN snapshot."data"->'notifications'
        ELSE '[]'::jsonb
    END
) AS notifications(notification_json)
WHERE snapshot."id" = 'main'
  AND COALESCE(notification_json->>'id', '') <> ''
  AND COALESCE(notification_json->>'userId', '') <> ''
ON CONFLICT ("id") DO NOTHING;
