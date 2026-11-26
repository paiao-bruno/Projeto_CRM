-- Transições observadas entre fotografias SGP. Aditivo: não apaga snapshots nem contratos.
CREATE TABLE "SgpChurnObservation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "integrationId" UUID,
    "snapshotId" UUID NOT NULL,
    "sgpCustomerId" TEXT NOT NULL,
    "sgpContractId" TEXT NOT NULL,
    "fromStatusCode" INTEGER,
    "toStatusCode" INTEGER,
    "quality" TEXT NOT NULL,
    "observedFrom" TIMESTAMP(3) NOT NULL,
    "observedTo" TIMESTAMP(3) NOT NULL,
    "statusDate" TIMESTAMP(3),
    "sourceEndpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SgpChurnObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SgpChurnObservation_tenant_contract_snap_status_key"
  ON "SgpChurnObservation" ("tenantId", "sgpContractId", "snapshotId", "toStatusCode");

CREATE INDEX "SgpChurnObservation_tenantId_quality_observedTo_idx"
  ON "SgpChurnObservation" ("tenantId", "quality", "observedTo");

ALTER TABLE "SgpChurnObservation"
  ADD CONSTRAINT "SgpChurnObservation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SgpChurnObservation"
  ADD CONSTRAINT "SgpChurnObservation_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "SgpChurnSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
