CREATE TYPE "IntegrationSyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL', 'SKIPPED');

CREATE TYPE "IntegrationSyncEntity" AS ENUM ('CUSTOMER', 'CONTRACT', 'INVOICE');

CREATE TABLE "IntegrationSyncRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "triggeredById" UUID,
    "operation" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "ignored" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "cursor" JSONB,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationSyncLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "entity" "IntegrationSyncEntity" NOT NULL,
    "externalId" TEXT,
    "action" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationSyncRun_tenantId_status_startedAt_idx" ON "IntegrationSyncRun"("tenantId", "status", "startedAt");
CREATE INDEX "IntegrationSyncRun_tenantId_operation_startedAt_idx" ON "IntegrationSyncRun"("tenantId", "operation", "startedAt");

CREATE INDEX "IntegrationSyncLog_tenantId_runId_createdAt_idx" ON "IntegrationSyncLog"("tenantId", "runId", "createdAt");
CREATE INDEX "IntegrationSyncLog_tenantId_entity_externalId_idx" ON "IntegrationSyncLog"("tenantId", "entity", "externalId");
CREATE INDEX "IntegrationSyncLog_tenantId_status_createdAt_idx" ON "IntegrationSyncLog"("tenantId", "status", "createdAt");

ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "TenantMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IntegrationSyncLog" ADD CONSTRAINT "IntegrationSyncLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntegrationSyncLog" ADD CONSTRAINT "IntegrationSyncLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IntegrationSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
