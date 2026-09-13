CREATE TABLE "HodiCommunicationProposal" (
    "id" TEXT NOT NULL,
    "approvalToken" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "handoffReadyAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HodiCommunicationProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HodiCommunicationProposal_approvalToken_key" ON "HodiCommunicationProposal"("approvalToken");
CREATE INDEX "HodiCommunicationProposal_userId_status_createdAt_idx" ON "HodiCommunicationProposal"("userId", "status", "createdAt");
CREATE INDEX "HodiCommunicationProposal_status_expiresAt_idx" ON "HodiCommunicationProposal"("status", "expiresAt");
CREATE INDEX "HodiCommunicationProposal_type_createdAt_idx" ON "HodiCommunicationProposal"("type", "createdAt");

CREATE TABLE "HodiAutomationRuleState" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HodiAutomationRuleState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HodiAutomationRuleState_ruleId_key" ON "HodiAutomationRuleState"("ruleId");
CREATE INDEX "HodiAutomationRuleState_enabled_updatedAt_idx" ON "HodiAutomationRuleState"("enabled", "updatedAt");

CREATE TABLE "HodiAutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL,
    "review" JSONB NOT NULL,
    "externalAction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HodiAutomationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HodiAutomationRun_ruleId_createdAt_idx" ON "HodiAutomationRun"("ruleId", "createdAt");
CREATE INDEX "HodiAutomationRun_triggeredBy_createdAt_idx" ON "HodiAutomationRun"("triggeredBy", "createdAt");
CREATE INDEX "HodiAutomationRun_status_createdAt_idx" ON "HodiAutomationRun"("status", "createdAt");
