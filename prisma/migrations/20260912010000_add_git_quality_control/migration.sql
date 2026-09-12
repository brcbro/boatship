CREATE TABLE "GitRepositoryConnection" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "repository" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "webhookSecretHash" TEXT,
  "accessTokenRef" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GitRepositoryConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GitRepositoryConnection_provider_owner_repository_idx" ON "GitRepositoryConnection"("provider", "owner", "repository");
CREATE INDEX "GitRepositoryConnection_createdBy_idx" ON "GitRepositoryConnection"("createdBy");

CREATE TABLE "GitTaskLink" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "branch" TEXT,
  "pullRequestUrl" TEXT,
  "pullRequestId" TEXT,
  "baseSha" TEXT,
  "headSha" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GitTaskLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitTaskLink_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitRepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GitTaskLink_taskId_repositoryId_key" ON "GitTaskLink"("taskId", "repositoryId");
CREATE INDEX "GitTaskLink_taskId_idx" ON "GitTaskLink"("taskId");
CREATE INDEX "GitTaskLink_repositoryId_idx" ON "GitTaskLink"("repositoryId");
CREATE INDEX "GitTaskLink_pullRequestId_idx" ON "GitTaskLink"("pullRequestId");

CREATE TABLE "DefinitionOfDonePolicy" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "taskType" TEXT,
  "requiredFiles" TEXT[] NOT NULL,
  "requiredChecks" TEXT[] NOT NULL,
  "requiredBuild" BOOLEAN NOT NULL DEFAULT false,
  "requiredScreenshot" BOOLEAN NOT NULL DEFAULT false,
  "requiredApproval" BOOLEAN NOT NULL DEFAULT false,
  "allowedPaths" TEXT[] NOT NULL,
  "maxStaleHours" INTEGER NOT NULL DEFAULT 72,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DefinitionOfDonePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefinitionOfDonePolicy_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitRepositoryConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "DefinitionOfDonePolicy_projectId_idx" ON "DefinitionOfDonePolicy"("projectId");
CREATE INDEX "DefinitionOfDonePolicy_repositoryId_idx" ON "DefinitionOfDonePolicy"("repositoryId");

CREATE TABLE "GitValidationRun" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "evidence" JSONB NOT NULL,
  "triggeredBy" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GitValidationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GitValidationRun_taskId_createdAt_idx" ON "GitValidationRun"("taskId", "createdAt");
CREATE INDEX "GitValidationRun_status_createdAt_idx" ON "GitValidationRun"("status", "createdAt");

CREATE TABLE "GitEvidence" (
  "id" TEXT NOT NULL,
  "taskId" TEXT,
  "repositoryId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "externalId" TEXT,
  "url" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitEvidence_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitRepositoryConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GitEvidence_taskId_createdAt_idx" ON "GitEvidence"("taskId", "createdAt");
CREATE INDEX "GitEvidence_repositoryId_createdAt_idx" ON "GitEvidence"("repositoryId", "createdAt");
CREATE INDEX "GitEvidence_kind_createdAt_idx" ON "GitEvidence"("kind", "createdAt");

CREATE TABLE "TaskManagerApproval" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "TaskManagerApproval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskManagerApproval_taskId_key" ON "TaskManagerApproval"("taskId");
CREATE INDEX "TaskManagerApproval_reviewerId_idx" ON "TaskManagerApproval"("reviewerId");
CREATE INDEX "TaskManagerApproval_status_idx" ON "TaskManagerApproval"("status");
