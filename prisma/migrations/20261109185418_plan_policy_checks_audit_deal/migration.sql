-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "dealId" TEXT,
ADD COLUMN     "paypalCall" TEXT;

-- AlterTable
ALTER TABLE "PlanItem" ADD COLUMN     "policyChecks" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "AuditLog_dealId_idx" ON "AuditLog"("dealId");
