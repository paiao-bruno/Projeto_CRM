-- CreateEnum
CREATE TYPE "DealPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable PipelineStage
ALTER TABLE "PipelineStage" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_pipelineId_code_key" ON "PipelineStage"("pipelineId", "code");

-- AlterTable Deal (additive columns with safe defaults)
ALTER TABLE "Deal" ADD COLUMN "phone" TEXT;
ALTER TABLE "Deal" ADD COLUMN "email" TEXT;
ALTER TABLE "Deal" ADD COLUMN "clientType" TEXT;
ALTER TABLE "Deal" ADD COLUMN "entrySource" TEXT;
ALTER TABLE "Deal" ADD COLUMN "contactType" TEXT;
ALTER TABLE "Deal" ADD COLUMN "city" TEXT;
ALTER TABLE "Deal" ADD COLUMN "neighborhood" TEXT;
ALTER TABLE "Deal" ADD COLUMN "priority" "DealPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Deal" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Deal" ADD COLUMN "nextAction" TEXT;
ALTER TABLE "Deal" ADD COLUMN "nextActionAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "notes" TEXT;
ALTER TABLE "Deal" ADD COLUMN "lossReason" TEXT;
ALTER TABLE "Deal" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "createdByMemberId" UUID;
ALTER TABLE "Deal" ADD COLUMN "updatedByMemberId" UUID;
ALTER TABLE "Deal" ADD COLUMN "lostByMemberId" UUID;
ALTER TABLE "Deal" ADD COLUMN "archivedByMemberId" UUID;
ALTER TABLE "Deal" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Allow zero-value deals for manual funnel entries
ALTER TABLE "Deal" ALTER COLUMN "valueCents" SET DEFAULT 0;

-- CreateTable DealHistory
CREATE TABLE "DealHistory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "fieldName" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "actorMemberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_tenantId_stageId_position_idx" ON "Deal"("tenantId", "stageId", "position");
CREATE INDEX "Deal_tenantId_ownerMemberId_idx" ON "Deal"("tenantId", "ownerMemberId");
CREATE INDEX "Deal_tenantId_archivedAt_idx" ON "Deal"("tenantId", "archivedAt");
CREATE INDEX "Deal_tenantId_entrySource_idx" ON "Deal"("tenantId", "entrySource");
CREATE INDEX "Deal_tenantId_clientType_idx" ON "Deal"("tenantId", "clientType");
CREATE INDEX "Deal_tenantId_city_idx" ON "Deal"("tenantId", "city");
CREATE INDEX "Deal_tenantId_nextActionAt_idx" ON "Deal"("tenantId", "nextActionAt");
CREATE INDEX "Deal_tenantId_createdAt_idx" ON "Deal"("tenantId", "createdAt");
CREATE INDEX "DealHistory_tenantId_dealId_createdAt_idx" ON "DealHistory"("tenantId", "dealId", "createdAt");
CREATE INDEX "DealHistory_tenantId_action_createdAt_idx" ON "DealHistory"("tenantId", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_updatedByMemberId_fkey" FOREIGN KEY ("updatedByMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_lostByMemberId_fkey" FOREIGN KEY ("lostByMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_archivedByMemberId_fkey" FOREIGN KEY ("archivedByMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DealHistory" ADD CONSTRAINT "DealHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealHistory" ADD CONSTRAINT "DealHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealHistory" ADD CONSTRAINT "DealHistory_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
