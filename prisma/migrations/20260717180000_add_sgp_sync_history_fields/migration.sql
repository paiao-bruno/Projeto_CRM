ALTER TABLE "IntegrationSyncRun"
ADD COLUMN "integrationId" UUID,
ADD COLUMN "syncMode" TEXT,
ADD COLUMN "trigger" TEXT,
ADD COLUMN "customersProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customersCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customersUpdated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customersDeleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "customersIgnored" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contractsProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contractsCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contractsUpdated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contractsDeleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contractsIgnored" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "invoicesProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "invoicesCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "invoicesUpdated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "invoicesDeleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "invoicesIgnored" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "errors" JSONB,
ADD COLUMN "stackTrace" TEXT;

CREATE INDEX "IntegrationSyncRun_tenantId_integrationId_startedAt_idx"
ON "IntegrationSyncRun"("tenantId", "integrationId", "startedAt");

ALTER TABLE "IntegrationSyncRun"
ADD CONSTRAINT "IntegrationSyncRun_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "Integration"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
