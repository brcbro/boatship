-- CreateTable
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'idea',
    "ownerId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'members',
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductMember" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductMilestone" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductWorkItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "dependencyIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductRelease" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "releasedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "repositoryId" TEXT,
    "commitSha" TEXT,
    "deploymentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "public"."Product"("slug");

-- CreateIndex
CREATE INDEX "Product_ownerId_idx" ON "public"."Product"("ownerId");

-- CreateIndex
CREATE INDEX "Product_stage_idx" ON "public"."Product"("stage");

-- CreateIndex
CREATE INDEX "ProductMember_userId_idx" ON "public"."ProductMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMember_productId_userId_key" ON "public"."ProductMember"("productId", "userId");

-- CreateIndex
CREATE INDEX "ProductMilestone_productId_status_idx" ON "public"."ProductMilestone"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductMilestone_targetDate_idx" ON "public"."ProductMilestone"("targetDate");

-- CreateIndex
CREATE INDEX "ProductWorkItem_productId_status_idx" ON "public"."ProductWorkItem"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductWorkItem_assigneeId_status_idx" ON "public"."ProductWorkItem"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ProductWorkItem_dueDate_idx" ON "public"."ProductWorkItem"("dueDate");

-- CreateIndex
CREATE INDEX "ProductRelease_productId_releasedAt_idx" ON "public"."ProductRelease"("productId", "releasedAt");

-- CreateIndex
CREATE INDEX "ProductRelease_repositoryId_idx" ON "public"."ProductRelease"("repositoryId");

-- AddForeignKey
ALTER TABLE "public"."ProductMember" ADD CONSTRAINT "ProductMember_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductMilestone" ADD CONSTRAINT "ProductMilestone_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductWorkItem" ADD CONSTRAINT "ProductWorkItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductWorkItem" ADD CONSTRAINT "ProductWorkItem_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "public"."ProductMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductRelease" ADD CONSTRAINT "ProductRelease_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductRelease" ADD CONSTRAINT "ProductRelease_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."GitRepositoryConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link releases to shipped product work without mixing product work into client tasks.
CREATE TABLE "public"."ProductReleaseWorkItem" (
    "releaseId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    CONSTRAINT "ProductReleaseWorkItem_pkey" PRIMARY KEY ("releaseId","workItemId")
);
CREATE INDEX "ProductReleaseWorkItem_workItemId_idx" ON "public"."ProductReleaseWorkItem"("workItemId");
ALTER TABLE "public"."ProductReleaseWorkItem" ADD CONSTRAINT "ProductReleaseWorkItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "public"."ProductRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProductReleaseWorkItem" ADD CONSTRAINT "ProductReleaseWorkItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "public"."ProductWorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product-scoped activity history for staff changes.
CREATE TABLE "public"."ProductActivity" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductActivity_productId_createdAt_idx" ON "public"."ProductActivity"("productId", "createdAt");
CREATE INDEX "ProductActivity_actorId_createdAt_idx" ON "public"."ProductActivity"("actorId", "createdAt");
ALTER TABLE "public"."ProductActivity" ADD CONSTRAINT "ProductActivity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
