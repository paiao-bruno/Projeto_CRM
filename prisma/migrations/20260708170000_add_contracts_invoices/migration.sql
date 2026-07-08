CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELED', 'UNKNOWN');

CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELED', 'UNKNOWN');

CREATE TABLE "Contract" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'UNKNOWN',
    "planName" TEXT,
    "serviceLogin" TEXT,
    "address" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "contractId" UUID,
    "externalId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "amountCents" INTEGER,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contract_tenantId_externalId_key" ON "Contract"("tenantId", "externalId");
CREATE INDEX "Contract_tenantId_customerId_idx" ON "Contract"("tenantId", "customerId");
CREATE INDEX "Contract_tenantId_status_idx" ON "Contract"("tenantId", "status");

CREATE UNIQUE INDEX "Invoice_tenantId_externalId_key" ON "Invoice"("tenantId", "externalId");
CREATE INDEX "Invoice_tenantId_customerId_idx" ON "Invoice"("tenantId", "customerId");
CREATE INDEX "Invoice_tenantId_contractId_idx" ON "Invoice"("tenantId", "contractId");
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");
CREATE INDEX "Invoice_tenantId_dueDate_idx" ON "Invoice"("tenantId", "dueDate");

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
