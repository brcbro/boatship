CREATE TABLE "HodiQueueItem" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "clientId" TEXT,
    "taskId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "ownerId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HodiQueueItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HodiQueueItem_dedupeKey_key" ON "HodiQueueItem"("dedupeKey");
CREATE INDEX "HodiQueueItem_status_priority_updatedAt_idx" ON "HodiQueueItem"("status", "priority", "updatedAt");
CREATE INDEX "HodiQueueItem_ownerId_status_idx" ON "HodiQueueItem"("ownerId", "status");
CREATE INDEX "HodiQueueItem_clientId_status_idx" ON "HodiQueueItem"("clientId", "status");
CREATE INDEX "HodiQueueItem_taskId_status_idx" ON "HodiQueueItem"("taskId", "status");
CREATE INDEX "HodiQueueItem_snoozedUntil_idx" ON "HodiQueueItem"("snoozedUntil");

CREATE TABLE "HodiActionProposal" (
    "id" TEXT NOT NULL,
    "approvalToken" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "preview" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HodiActionProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HodiActionProposal_approvalToken_key" ON "HodiActionProposal"("approvalToken");
CREATE INDEX "HodiActionProposal_userId_status_createdAt_idx" ON "HodiActionProposal"("userId", "status", "createdAt");
CREATE INDEX "HodiActionProposal_status_expiresAt_idx" ON "HodiActionProposal"("status", "expiresAt");
CREATE INDEX "HodiActionProposal_action_createdAt_idx" ON "HodiActionProposal"("action", "createdAt");
