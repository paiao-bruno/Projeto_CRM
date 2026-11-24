-- CreateTable
CREATE TABLE "CommercialGoal" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "createdByMemberId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialGoal_tenantId_metric_kind_key" ON "CommercialGoal"("tenantId", "metric", "kind");
CREATE INDEX "CommercialGoal_tenantId_kind_idx" ON "CommercialGoal"("tenantId", "kind");

CREATE TABLE "FunnelCommercialEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "dealId" UUID,
    "customerId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelCommercialEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FunnelCommercialEvent_tenantId_type_occurredAt_idx" ON "FunnelCommercialEvent"("tenantId", "type", "occurredAt");
CREATE INDEX "FunnelCommercialEvent_tenantId_dealId_type_idx" ON "FunnelCommercialEvent"("tenantId", "dealId", "type");
CREATE INDEX "FunnelCommercialEvent_tenantId_customerId_type_idx" ON "FunnelCommercialEvent"("tenantId", "customerId", "type");

ALTER TABLE "CommercialGoal" ADD CONSTRAINT "CommercialGoal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FunnelCommercialEvent" ADD CONSTRAINT "FunnelCommercialEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FunnelCommercialEvent" ADD CONSTRAINT "FunnelCommercialEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FunnelCommercialEvent" ADD CONSTRAINT "FunnelCommercialEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
