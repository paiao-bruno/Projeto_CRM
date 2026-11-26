CREATE TABLE "SgpChurnSnapshot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID,
    "status" TEXT NOT NULL,
    "coverage" TEXT NOT NULL,
    "sourceEndpoint" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SgpChurnSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SgpChurnSnapshot_tenantId_status_finishedAt_idx" ON "SgpChurnSnapshot"("tenantId", "status", "finishedAt");

CREATE TABLE "SgpChurnContract" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "sgpCustomerId" TEXT NOT NULL,
    "sgpContractId" TEXT NOT NULL,
    "statusCode" INTEGER,
    "statusLabel" TEXT NOT NULL,
    "reason" TEXT,
    "planName" TEXT,
    "statusDate" TIMESTAMP(3),
    "isCancelled" BOOLEAN NOT NULL,
    "isActiveService" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SgpChurnContract_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SgpChurnContract_snapshotId_sgpContractId_key" ON "SgpChurnContract"("snapshotId", "sgpContractId");
CREATE INDEX "SgpChurnContract_tenantId_snapshotId_isCancelled_idx" ON "SgpChurnContract"("tenantId", "snapshotId", "isCancelled");
CREATE INDEX "SgpChurnContract_tenantId_sgpCustomerId_idx" ON "SgpChurnContract"("tenantId", "sgpCustomerId");

ALTER TABLE "SgpChurnSnapshot" ADD CONSTRAINT "SgpChurnSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SgpChurnContract" ADD CONSTRAINT "SgpChurnContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SgpChurnContract" ADD CONSTRAINT "SgpChurnContract_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "SgpChurnSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
