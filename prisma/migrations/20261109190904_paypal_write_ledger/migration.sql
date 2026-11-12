-- CreateEnum
CREATE TYPE "PayPalWriteStatus" AS ENUM ('CLAIMED', 'SUCCEEDED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "PayPalWrite" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "PayPalWriteStatus" NOT NULL DEFAULT 'CLAIMED',
    "resultRef" TEXT,
    "lastError" JSONB,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PayPalWrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPalWrite_key_key" ON "PayPalWrite"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalWrite_requestId_key" ON "PayPalWrite"("requestId");

-- CreateIndex
CREATE INDEX "PayPalWrite_status_idx" ON "PayPalWrite"("status");

-- CreateIndex
CREATE INDEX "PayPalWrite_dealId_idx" ON "PayPalWrite"("dealId");
