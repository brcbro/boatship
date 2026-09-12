CREATE TABLE "McpIdentity" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "scopes" TEXT[] NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "McpIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpProjectAccess" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "McpProjectAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "McpAuditEvent" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "resource" TEXT,
    "action" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpIdentity_publicId_key" ON "McpIdentity"("publicId");
CREATE UNIQUE INDEX "McpIdentity_tokenHash_key" ON "McpIdentity"("tokenHash");
CREATE INDEX "McpIdentity_userId_idx" ON "McpIdentity"("userId");
CREATE INDEX "McpIdentity_status_idx" ON "McpIdentity"("status");
CREATE INDEX "McpIdentity_revokedAt_idx" ON "McpIdentity"("revokedAt");
CREATE UNIQUE INDEX "McpProjectAccess_identityId_projectId_key" ON "McpProjectAccess"("identityId", "projectId");
CREATE INDEX "McpProjectAccess_identityId_idx" ON "McpProjectAccess"("identityId");
CREATE INDEX "McpProjectAccess_projectId_idx" ON "McpProjectAccess"("projectId");
CREATE INDEX "McpAuditEvent_identityId_createdAt_idx" ON "McpAuditEvent"("identityId", "createdAt");
CREATE INDEX "McpAuditEvent_userId_createdAt_idx" ON "McpAuditEvent"("userId", "createdAt");
CREATE INDEX "McpAuditEvent_toolName_createdAt_idx" ON "McpAuditEvent"("toolName", "createdAt");
ALTER TABLE "McpProjectAccess" ADD CONSTRAINT "McpProjectAccess_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "McpIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpAuditEvent" ADD CONSTRAINT "McpAuditEvent_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "McpIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
