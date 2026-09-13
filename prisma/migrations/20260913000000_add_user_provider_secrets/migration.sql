CREATE TABLE "UserProviderSecret" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "last4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProviderSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProviderSecret_userId_provider_key" ON "UserProviderSecret"("userId", "provider");
CREATE INDEX "UserProviderSecret_userId_idx" ON "UserProviderSecret"("userId");
CREATE INDEX "UserProviderSecret_provider_idx" ON "UserProviderSecret"("provider");
