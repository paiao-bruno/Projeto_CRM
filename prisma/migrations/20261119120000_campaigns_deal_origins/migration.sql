-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "Campaign" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Campaign" ALTER COLUMN "messageTemplate" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN "campaignId" UUID;
ALTER TABLE "Deal" ADD COLUMN "saleOriginId" UUID;

-- CreateTable
CREATE TABLE "SaleOrigin" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleOrigin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleOrigin_tenantId_nameKey_key" ON "SaleOrigin"("tenantId", "nameKey");
CREATE INDEX "SaleOrigin_tenantId_active_idx" ON "SaleOrigin"("tenantId", "active");
CREATE INDEX "Campaign_tenantId_archivedAt_idx" ON "Campaign"("tenantId", "archivedAt");
CREATE INDEX "Campaign_tenantId_channel_idx" ON "Campaign"("tenantId", "channel");
CREATE INDEX "Deal_tenantId_campaignId_idx" ON "Deal"("tenantId", "campaignId");
CREATE INDEX "Deal_tenantId_saleOriginId_idx" ON "Deal"("tenantId", "saleOriginId");

ALTER TABLE "SaleOrigin" ADD CONSTRAINT "SaleOrigin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_saleOriginId_fkey" FOREIGN KEY ("saleOriginId") REFERENCES "SaleOrigin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
